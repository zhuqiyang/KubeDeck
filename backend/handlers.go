package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"runtime/debug"
	"strconv"
	"strings"
	"time"
)

type apiServer struct {
	cfg      config
	kube     *kubeClient
	sessions *sessionManager
	limiter  *loginLimiter
	web      fs.FS
	logger   *slog.Logger
	mux      *http.ServeMux
}

func newServer(cfg config, kube *kubeClient, logger *slog.Logger) http.Handler {
	server := &apiServer{
		cfg:      cfg,
		kube:     kube,
		sessions: newSessionManager(cfg.SessionSecret, cfg.SessionTTL),
		limiter:  newLoginLimiter(),
		web:      webFiles(),
		logger:   logger,
		mux:      http.NewServeMux(),
	}
	server.routes()
	return server.middleware(server.mux)
}

func (s *apiServer) routes() {
	s.mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	s.mux.HandleFunc("GET /api/auth/status", s.handleAuthStatus)
	s.mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	s.mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	s.mux.HandleFunc("GET /api/bootstrap", s.auth(s.handleBootstrap))
	s.mux.HandleFunc("GET /api/overview", s.auth(s.handleOverview))
	s.mux.HandleFunc("GET /api/resources", s.auth(s.handleResources))
	s.mux.HandleFunc("GET /api/resource", s.auth(s.handleResource))
	s.mux.HandleFunc("PUT /api/resource", s.auth(s.handleUpdateResource))
	s.mux.HandleFunc("GET /api/events", s.auth(s.handleEvents))
	s.mux.HandleFunc("POST /api/action", s.auth(s.handleAction))
	s.mux.HandleFunc("GET /api/logs", s.auth(s.handleLogs))
	s.mux.HandleFunc("/", s.handleStatic)
}

func (s *apiServer) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; connect-src 'self'; font-src 'self' data:")
		defer func() {
			if recovered := recover(); recovered != nil {
				s.logger.Error("request panic", "panic", recovered, "stack", string(debug.Stack()))
				writeError(w, http.StatusInternalServerError, "服务内部错误")
			}
			s.logger.Info("request", "method", r.Method, "path", r.URL.Path, "duration_ms", time.Since(start).Milliseconds())
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *apiServer) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.cfg.AuthDisabled && !s.sessions.authenticated(r) {
			writeError(w, http.StatusUnauthorized, "请先登录")
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if origin := r.Header.Get("Origin"); origin != "" && !sameOrigin(origin, r.Host) {
				writeError(w, http.StatusForbidden, "跨站请求已被拒绝")
				return
			}
		}
		next(w, r)
	}
}

func (s *apiServer) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"authenticated": s.cfg.AuthDisabled || s.sessions.authenticated(r),
		"authDisabled":  s.cfg.AuthDisabled,
		"clusterName":   s.cfg.ClusterName,
	})
}

func (s *apiServer) handleLogin(w http.ResponseWriter, r *http.Request) {
	if s.cfg.AuthDisabled {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	ip := requestIP(r)
	if !s.limiter.allowed(ip) {
		writeError(w, http.StatusTooManyRequests, "尝试次数过多，请稍后再试")
		return
	}
	var input struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if !equalSecret(s.cfg.Password, input.Password) {
		s.limiter.failed(ip)
		time.Sleep(300 * time.Millisecond)
		writeError(w, http.StatusUnauthorized, "密码错误")
		return
	}
	s.limiter.reset(ip)
	value, err := s.sessions.create()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "创建会话失败")
		return
	}
	s.sessions.setCookie(w, value)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *apiServer) handleLogout(w http.ResponseWriter, _ *http.Request) {
	s.sessions.clearCookie(w)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *apiServer) handleBootstrap(w http.ResponseWriter, r *http.Request) {
	namespaces, err := s.kube.namespaces(r.Context())
	if err != nil {
		s.writeKubeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"clusterName": s.cfg.ClusterName,
		"namespaces":  namespaces,
		"catalog":     resources,
	})
}

func (s *apiServer) handleOverview(w http.ResponseWriter, r *http.Request) {
	namespace := namespaceQuery(r)
	result, err := s.kube.overview(r.Context(), namespace, s.cfg.ClusterName)
	if err != nil {
		s.writeKubeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *apiServer) handleResources(w http.ResponseWriter, r *http.Request) {
	resource, ok := resourceForRequest(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "未知资源类型")
		return
	}
	items, err := s.kube.listResources(r.Context(), resource, namespaceQuery(r), r.URL.Query().Get("search"))
	if err != nil {
		s.writeKubeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"items": items, "total": len(items)})
}

func (s *apiServer) handleResource(w http.ResponseWriter, r *http.Request) {
	resource, ok := resourceForRequest(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "未知资源类型")
		return
	}
	name := r.URL.Query().Get("name")
	if name == "" {
		writeError(w, http.StatusBadRequest, "缺少资源名称")
		return
	}
	object, err := s.kube.getResource(r.Context(), resource, namespaceQuery(r), name)
	if err != nil {
		s.writeKubeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, object)
}

func (s *apiServer) handleUpdateResource(w http.ResponseWriter, r *http.Request) {
	resource, ok := resourceForRequest(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "未知资源类型")
		return
	}
	if !resourceEditable(resource.Key) {
		writeError(w, http.StatusForbidden, "该资源不允许在控制台编辑")
		return
	}
	var input struct {
		Object map[string]interface{} `json:"object"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "资源内容格式错误")
		return
	}
	name := r.URL.Query().Get("name")
	if name == "" {
		writeError(w, http.StatusBadRequest, "缺少资源名称")
		return
	}
	dryRun, _ := strconv.ParseBool(r.URL.Query().Get("dryRun"))
	if err := s.kube.updateResource(r.Context(), resource, namespaceQuery(r), name, input.Object, dryRun); err != nil {
		s.writeKubeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *apiServer) handleEvents(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := s.kube.events(r.Context(), namespaceQuery(r), limit)
	if err != nil {
		s.writeKubeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

type actionRequest struct {
	Action    string `json:"action"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Replicas  *int64 `json:"replicas,omitempty"`
}

func (s *apiServer) handleAction(w http.ResponseWriter, r *http.Request) {
	var request actionRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	resource, ok := resourcesByKey[request.Kind]
	if !ok || request.Name == "" {
		writeError(w, http.StatusBadRequest, "资源参数无效")
		return
	}
	var err error
	switch request.Action {
	case "restart":
		if !resourceRestartable(request.Kind) {
			writeError(w, http.StatusBadRequest, "该资源不支持滚动重启")
			return
		}
		err = s.kube.restartResource(r.Context(), resource, request.Namespace, request.Name)
	case "scale":
		if !resourceScalable(request.Kind) || request.Replicas == nil || *request.Replicas < 0 || *request.Replicas > 10000 {
			writeError(w, http.StatusBadRequest, "扩缩容参数无效")
			return
		}
		err = s.kube.scaleResource(r.Context(), resource, request.Namespace, request.Name, *request.Replicas)
	case "delete":
		if !resourceDeletable(request.Kind) {
			writeError(w, http.StatusForbidden, "该资源不允许在控制台删除")
			return
		}
		err = s.kube.deleteResource(r.Context(), resource, request.Namespace, request.Name)
	default:
		writeError(w, http.StatusBadRequest, "不支持的操作")
		return
	}
	if err != nil {
		s.writeKubeError(w, err)
		return
	}
	s.logger.Info("resource action", "action", request.Action, "kind", request.Kind, "namespace", request.Namespace, "name", request.Name)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *apiServer) handleLogs(w http.ResponseWriter, r *http.Request) {
	namespace := r.URL.Query().Get("namespace")
	pod := r.URL.Query().Get("pod")
	container := r.URL.Query().Get("container")
	tailLines, _ := strconv.ParseInt(r.URL.Query().Get("tailLines"), 10, 64)
	follow := r.URL.Query().Get("follow") == "true"
	if namespace == "" || pod == "" {
		writeError(w, http.StatusBadRequest, "namespace 和 pod 不能为空")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "日志流不受支持")
		return
	}
	stream, err := s.kube.podLogs(r.Context(), namespace, pod, container, tailLines, follow)
	if err != nil {
		s.writeKubeError(w, err)
		return
	}
	defer stream.Close()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	scanner := bufio.NewScanner(stream)
	scanner.Buffer(make([]byte, 64<<10), 2<<20)
	for scanner.Scan() {
		payload, _ := json.Marshal(scanner.Text())
		if _, err := fmt.Fprintf(w, "event: log\ndata: %s\n\n", payload); err != nil {
			return
		}
		flusher.Flush()
	}
	if err := scanner.Err(); err != nil && !errors.Is(err, context.Canceled) {
		payload, _ := json.Marshal(err.Error())
		_, _ = fmt.Fprintf(w, "event: error\ndata: %s\n\n", payload)
	}
	_, _ = io.WriteString(w, "event: end\ndata: {}\n\n")
	flusher.Flush()
}

func (s *apiServer) handleStatic(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeError(w, http.StatusNotFound, "接口不存在")
		return
	}
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name == "." || name == "" {
		name = "index.html"
	}
	content, err := fs.ReadFile(s.web, name)
	if err != nil {
		content, err = fs.ReadFile(s.web, "index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		name = "index.html"
	}
	switch {
	case strings.HasSuffix(name, ".js"):
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	case strings.HasSuffix(name, ".css"):
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	case strings.HasSuffix(name, ".svg"):
		w.Header().Set("Content-Type", "image/svg+xml")
	case strings.HasSuffix(name, ".woff2"):
		w.Header().Set("Content-Type", "font/woff2")
	default:
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
	}
	_, _ = w.Write(content)
}

func (s *apiServer) writeKubeError(w http.ResponseWriter, err error) {
	s.logger.Error("kubernetes request failed", "error", err)
	var kubeErr *apiError
	if errors.As(err, &kubeErr) {
		status := kubeErr.Status
		if status < 400 || status > 599 {
			status = http.StatusBadGateway
		}
		message := kubeErr.Message
		if status == http.StatusForbidden {
			message = "当前服务账号没有执行该操作的权限"
		}
		writeError(w, status, message)
		return
	}
	writeError(w, http.StatusBadGateway, "无法连接 Kubernetes API："+err.Error())
}

func namespaceQuery(r *http.Request) string {
	namespace := strings.TrimSpace(r.URL.Query().Get("namespace"))
	if namespace == "_all" {
		return ""
	}
	return namespace
}

func resourceEditable(key string) bool {
	switch key {
	case "deployments", "statefulsets", "daemonsets", "replicasets", "jobs", "cronjobs",
		"services", "ingresses", "networkpolicies", "configmaps", "persistentvolumeclaims":
		return true
	default:
		return false
	}
}

func resourceRestartable(key string) bool {
	return key == "deployments" || key == "statefulsets" || key == "daemonsets"
}

func resourceScalable(key string) bool {
	return key == "deployments" || key == "statefulsets" || key == "replicasets"
}

func resourceDeletable(key string) bool {
	switch key {
	case "deployments", "statefulsets", "daemonsets", "replicasets", "jobs", "cronjobs",
		"pods", "services", "ingresses", "networkpolicies", "configmaps", "secrets",
		"persistentvolumeclaims":
		return true
	default:
		return false
	}
}

func writeJSON(w http.ResponseWriter, status int, value interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
