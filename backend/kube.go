package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

const serviceAccountDir = "/var/run/secrets/kubernetes.io/serviceaccount"

type kubeClient struct {
	baseURL string
	token   string
	client  *http.Client
}

type apiError struct {
	Status  int
	Message string
}

func (e *apiError) Error() string {
	return e.Message
}

func newKubeClient() (*kubeClient, error) {
	host := os.Getenv("KUBERNETES_SERVICE_HOST")
	port := envOr("KUBERNETES_SERVICE_PORT", "443")
	if host == "" {
		return nil, errors.New("KUBERNETES_SERVICE_HOST is not set")
	}
	token, err := os.ReadFile(serviceAccountDir + "/token")
	if err != nil {
		return nil, fmt.Errorf("read service account token: %w", err)
	}
	ca, err := os.ReadFile(serviceAccountDir + "/ca.crt")
	if err != nil {
		return nil, fmt.Errorf("read service account CA: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(ca) {
		return nil, errors.New("service account CA is invalid")
	}
	transport := &http.Transport{
		TLSClientConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
			RootCAs:    pool,
		},
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
	}
	return &kubeClient{
		baseURL: "https://" + host + ":" + port,
		token:   strings.TrimSpace(string(token)),
		client:  &http.Client{Transport: transport},
	}, nil
}

func (k *kubeClient) request(ctx context.Context, method, path string, query url.Values, body []byte) (map[string]interface{}, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	u := k.baseURL + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+k.token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "kubedeck/0.1")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := k.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, decodeAPIError(resp.StatusCode, payload)
	}
	var object map[string]interface{}
	if err := json.Unmarshal(payload, &object); err != nil {
		return nil, fmt.Errorf("decode Kubernetes response: %w", err)
	}
	return object, nil
}

func (k *kubeClient) stream(ctx context.Context, path string, query url.Values) (io.ReadCloser, error) {
	u := k.baseURL + path + "?" + query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+k.token)
	req.Header.Set("Accept", "*/*")
	req.Header.Set("User-Agent", "kubedeck/0.1")
	resp, err := k.client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		defer resp.Body.Close()
		payload, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return nil, decodeAPIError(resp.StatusCode, payload)
	}
	return resp.Body, nil
}

func decodeAPIError(status int, payload []byte) error {
	var object map[string]interface{}
	_ = json.Unmarshal(payload, &object)
	message := stringAt(object, "message")
	if message == "" {
		message = http.StatusText(status)
	}
	return &apiError{Status: status, Message: message}
}

func (resource routeDefinition) basePath(namespace string) string {
	prefix := "/api/" + resource.Version
	if resource.Group != "" {
		prefix = "/apis/" + resource.Group + "/" + resource.Version
	}
	if !resource.Namespaced {
		return prefix + "/" + resource.Plural
	}
	if namespace == "" || namespace == "_all" {
		return prefix + "/" + resource.Plural
	}
	return prefix + "/namespaces/" + url.PathEscape(namespace) + "/" + resource.Plural
}

func (resource routeDefinition) objectPath(namespace, name string) string {
	return resource.basePath(namespace) + "/" + url.PathEscape(name)
}

type resourceItem struct {
	Name       string            `json:"name"`
	Namespace  string            `json:"namespace,omitempty"`
	Kind       string            `json:"kind"`
	Status     string            `json:"status"`
	StatusTone string            `json:"statusTone"`
	Ready      string            `json:"ready,omitempty"`
	Restarts   int64             `json:"restarts"`
	Age        string            `json:"age"`
	CreatedAt  time.Time         `json:"createdAt"`
	Node       string            `json:"node,omitempty"`
	Image      string            `json:"image,omitempty"`
	ImageCount int               `json:"imageCount,omitempty"`
	IP         string            `json:"ip,omitempty"`
	Type       string            `json:"type,omitempty"`
	Detail     string            `json:"detail,omitempty"`
	Labels     map[string]string `json:"labels,omitempty"`
}

type eventItem struct {
	ID            string    `json:"id"`
	Type          string    `json:"type"`
	Reason        string    `json:"reason"`
	Message       string    `json:"message"`
	Namespace     string    `json:"namespace"`
	ObjectKind    string    `json:"objectKind"`
	ObjectName    string    `json:"objectName"`
	Count         int64     `json:"count"`
	LastTimestamp time.Time `json:"lastTimestamp"`
	Age           string    `json:"age"`
}

type clusterSummary struct {
	Version           string  `json:"version"`
	Name              string  `json:"name"`
	NodesReady        int     `json:"nodesReady"`
	NodesTotal        int     `json:"nodesTotal"`
	PodsRunning       int     `json:"podsRunning"`
	PodsPending       int     `json:"podsPending"`
	PodsFailed        int     `json:"podsFailed"`
	PodsTotal         int     `json:"podsTotal"`
	Deployments       int     `json:"deployments"`
	DeployReady       int     `json:"deployReady"`
	Services          int     `json:"services"`
	Namespaces        int     `json:"namespaces"`
	CPUAllocatable    float64 `json:"cpuAllocatable"`
	MemoryAllocatable int64   `json:"memoryAllocatable"`
}

type overviewResponse struct {
	Cluster          clusterSummary `json:"cluster"`
	UnhealthyPods    []resourceItem `json:"unhealthyPods"`
	Workloads        []resourceItem `json:"workloads"`
	RecentEvents     []eventItem    `json:"recentEvents"`
	CPUUsage         float64        `json:"cpuUsage"`
	MemoryUsageBytes int64          `json:"memoryUsageBytes"`
	MetricsAvailable bool           `json:"metricsAvailable"`
}

func (k *kubeClient) namespaces(ctx context.Context) ([]string, error) {
	object, err := k.request(ctx, http.MethodGet, "/api/v1/namespaces", nil, nil)
	if err != nil {
		return nil, err
	}
	items := sliceAt(object, "items")
	names := make([]string, 0, len(items))
	for _, raw := range items {
		item, _ := raw.(map[string]interface{})
		names = append(names, stringAt(item, "metadata", "name"))
	}
	sort.Strings(names)
	return names, nil
}

func (k *kubeClient) listResources(ctx context.Context, resource routeDefinition, namespace, search string) ([]resourceItem, error) {
	object, err := k.request(ctx, http.MethodGet, resource.basePath(namespace), nil, nil)
	if err != nil {
		return nil, err
	}
	rows := make([]resourceItem, 0)
	search = strings.ToLower(strings.TrimSpace(search))
	for _, raw := range sliceAt(object, "items") {
		item, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		row := summarize(resource, item)
		haystack := strings.ToLower(row.Name + " " + row.Namespace + " " + row.Image + " " + row.Node + " " + row.Status)
		if search != "" && !strings.Contains(haystack, search) {
			continue
		}
		rows = append(rows, row)
	}
	sort.Slice(rows, func(i, j int) bool {
		left, right := toneRank(rows[i].StatusTone), toneRank(rows[j].StatusTone)
		if left != right {
			return left < right
		}
		return rows[i].CreatedAt.After(rows[j].CreatedAt)
	})
	return rows, nil
}

func (k *kubeClient) getResource(ctx context.Context, resource routeDefinition, namespace, name string) (map[string]interface{}, error) {
	object, err := k.request(ctx, http.MethodGet, resource.objectPath(namespace, name), nil, nil)
	if err != nil {
		return nil, err
	}
	sanitizeResource(resource, object)
	return object, nil
}

func (k *kubeClient) updateResource(ctx context.Context, resource routeDefinition, namespace, name string, object map[string]interface{}, dryRun bool) error {
	delete(object, "status")
	metadata, _ := object["metadata"].(map[string]interface{})
	if metadata == nil {
		return errors.New("metadata is required")
	}
	delete(metadata, "managedFields")
	if stringAt(metadata, "name") != name {
		return errors.New("metadata.name does not match the edited resource")
	}
	if resource.Namespaced && stringAt(metadata, "namespace") != namespace {
		return errors.New("metadata.namespace does not match the edited resource")
	}
	payload, err := json.Marshal(object)
	if err != nil {
		return err
	}
	query := url.Values{}
	if dryRun {
		query.Set("dryRun", "All")
	}
	_, err = k.request(ctx, http.MethodPut, resource.objectPath(namespace, name), query, payload)
	return err
}

func (k *kubeClient) deleteResource(ctx context.Context, resource routeDefinition, namespace, name string) error {
	_, err := k.request(ctx, http.MethodDelete, resource.objectPath(namespace, name), nil, nil)
	return err
}

func (k *kubeClient) scaleResource(ctx context.Context, resource routeDefinition, namespace, name string, replicas int64) error {
	payload := []byte(fmt.Sprintf(`{"spec":{"replicas":%d}}`, replicas))
	path := resource.objectPath(namespace, name) + "/scale"
	_, err := k.requestRaw(ctx, http.MethodPatch, path, nil, payload, "application/merge-patch+json")
	return err
}

func (k *kubeClient) restartResource(ctx context.Context, resource routeDefinition, namespace, name string) error {
	timestamp := time.Now().UTC().Format(time.RFC3339)
	payload, _ := json.Marshal(map[string]interface{}{
		"spec": map[string]interface{}{
			"template": map[string]interface{}{
				"metadata": map[string]interface{}{
					"annotations": map[string]string{
						"kubectl.kubernetes.io/restartedAt": timestamp,
					},
				},
			},
		},
	})
	_, err := k.requestRaw(ctx, http.MethodPatch, resource.objectPath(namespace, name), nil, payload, "application/strategic-merge-patch+json")
	return err
}

func (k *kubeClient) requestRaw(ctx context.Context, method, path string, query url.Values, body []byte, contentType string) (map[string]interface{}, error) {
	u := k.baseURL + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+k.token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("User-Agent", "kubedeck/0.1")
	resp, err := k.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	payload, _ := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, decodeAPIError(resp.StatusCode, payload)
	}
	var object map[string]interface{}
	_ = json.Unmarshal(payload, &object)
	return object, nil
}

func (k *kubeClient) events(ctx context.Context, namespace string, limit int) ([]eventItem, error) {
	path := "/api/v1/events"
	if namespace != "" && namespace != "_all" {
		path = "/api/v1/namespaces/" + url.PathEscape(namespace) + "/events"
	}
	object, err := k.request(ctx, http.MethodGet, path, nil, nil)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	items := make([]eventItem, 0)
	for _, raw := range sliceAt(object, "items") {
		item, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		timestamp := parseTime(stringAt(item, "lastTimestamp"))
		if timestamp.IsZero() {
			timestamp = parseTime(stringAt(item, "eventTime"))
		}
		if timestamp.IsZero() {
			timestamp = parseTime(stringAt(item, "metadata", "creationTimestamp"))
		}
		count := intAt(item, "count")
		if count == 0 {
			count = 1
		}
		items = append(items, eventItem{
			ID:            stringAt(item, "metadata", "uid"),
			Type:          stringAt(item, "type"),
			Reason:        stringAt(item, "reason"),
			Message:       stringAt(item, "message"),
			Namespace:     stringAt(item, "metadata", "namespace"),
			ObjectKind:    stringAt(item, "involvedObject", "kind"),
			ObjectName:    stringAt(item, "involvedObject", "name"),
			Count:         count,
			LastTimestamp: timestamp,
			Age:           shortAge(now.Sub(timestamp)),
		})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].LastTimestamp.After(items[j].LastTimestamp) })
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

func (k *kubeClient) overview(ctx context.Context, namespace, clusterName string) (overviewResponse, error) {
	podObject, err := k.request(ctx, http.MethodGet, resourcesByKey["pods"].basePath(namespace), nil, nil)
	if err != nil {
		return overviewResponse{}, err
	}
	nodeObject, err := k.request(ctx, http.MethodGet, resourcesByKey["nodes"].basePath(""), nil, nil)
	if err != nil {
		return overviewResponse{}, err
	}
	deployObject, err := k.request(ctx, http.MethodGet, resourcesByKey["deployments"].basePath(namespace), nil, nil)
	if err != nil {
		return overviewResponse{}, err
	}
	serviceObject, err := k.request(ctx, http.MethodGet, resourcesByKey["services"].basePath(namespace), nil, nil)
	if err != nil {
		return overviewResponse{}, err
	}
	namespaceObject, err := k.request(ctx, http.MethodGet, resourcesByKey["namespaces"].basePath(""), nil, nil)
	if err != nil {
		return overviewResponse{}, err
	}
	versionObject, _ := k.request(ctx, http.MethodGet, "/version", nil, nil)

	summary := clusterSummary{
		Name:        clusterName,
		Version:     stringAt(versionObject, "gitVersion"),
		NodesTotal:  len(sliceAt(nodeObject, "items")),
		PodsTotal:   len(sliceAt(podObject, "items")),
		Deployments: len(sliceAt(deployObject, "items")),
		Services:    len(sliceAt(serviceObject, "items")),
		Namespaces:  len(sliceAt(namespaceObject, "items")),
	}
	for _, raw := range sliceAt(nodeObject, "items") {
		node, _ := raw.(map[string]interface{})
		if nodeReady(node) {
			summary.NodesReady++
		}
		cpu := quantityCPU(stringAt(node, "status", "allocatable", "cpu"))
		memory := quantityMemory(stringAt(node, "status", "allocatable", "memory"))
		summary.CPUAllocatable += cpu
		summary.MemoryAllocatable += memory
	}

	unhealthy := make([]resourceItem, 0)
	for _, raw := range sliceAt(podObject, "items") {
		pod, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		phase := stringAt(pod, "status", "phase")
		switch phase {
		case "Running":
			summary.PodsRunning++
		case "Pending":
			summary.PodsPending++
		case "Failed":
			summary.PodsFailed++
		}
		row := summarize(resourcesByKey["pods"], pod)
		if row.StatusTone == "danger" || row.StatusTone == "warning" {
			unhealthy = append(unhealthy, row)
		}
	}
	sort.Slice(unhealthy, func(i, j int) bool {
		if unhealthy[i].StatusTone != unhealthy[j].StatusTone {
			return toneRank(unhealthy[i].StatusTone) < toneRank(unhealthy[j].StatusTone)
		}
		return unhealthy[i].Restarts > unhealthy[j].Restarts
	})
	if len(unhealthy) > 8 {
		unhealthy = unhealthy[:8]
	}

	workloads := make([]resourceItem, 0)
	for _, raw := range sliceAt(deployObject, "items") {
		deployment, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		desired := intAt(deployment, "spec", "replicas")
		if _, exists := mapAt(deployment, "spec")["replicas"]; !exists {
			desired = 1
		}
		ready := intAt(deployment, "status", "readyReplicas")
		if desired > 0 && ready >= desired {
			summary.DeployReady++
		}
		workloads = append(workloads, summarize(resourcesByKey["deployments"], deployment))
	}
	sort.Slice(workloads, func(i, j int) bool {
		if workloads[i].StatusTone != workloads[j].StatusTone {
			return toneRank(workloads[i].StatusTone) < toneRank(workloads[j].StatusTone)
		}
		return workloads[i].Name < workloads[j].Name
	})
	if len(workloads) > 8 {
		workloads = workloads[:8]
	}

	events, _ := k.events(ctx, namespace, 8)
	cpuUsage, memoryUsage, metricsAvailable := k.metricsUsage(ctx, namespace)
	return overviewResponse{
		Cluster:          summary,
		UnhealthyPods:    unhealthy,
		Workloads:        workloads,
		RecentEvents:     events,
		CPUUsage:         cpuUsage,
		MemoryUsageBytes: memoryUsage,
		MetricsAvailable: metricsAvailable,
	}, nil
}

func (k *kubeClient) metricsUsage(ctx context.Context, namespace string) (float64, int64, bool) {
	path := "/apis/metrics.k8s.io/v1beta1/pods"
	if namespace != "" && namespace != "_all" {
		path = "/apis/metrics.k8s.io/v1beta1/namespaces/" + url.PathEscape(namespace) + "/pods"
	}
	object, err := k.request(ctx, http.MethodGet, path, nil, nil)
	if err != nil {
		return 0, 0, false
	}
	var cpuMilli float64
	var memoryBytes int64
	for _, raw := range sliceAt(object, "items") {
		item, _ := raw.(map[string]interface{})
		for _, containerRaw := range sliceAt(item, "containers") {
			container, _ := containerRaw.(map[string]interface{})
			cpuMilli += quantityCPU(stringAt(container, "usage", "cpu"))
			memoryBytes += quantityMemory(stringAt(container, "usage", "memory"))
		}
	}
	return cpuMilli / 1000, memoryBytes, true
}

func (k *kubeClient) podLogs(ctx context.Context, namespace, pod, container string, tailLines int64, follow bool) (io.ReadCloser, error) {
	query := url.Values{}
	if container != "" {
		query.Set("container", container)
	}
	if tailLines > 0 {
		query.Set("tailLines", strconv.FormatInt(tailLines, 10))
	}
	if follow {
		query.Set("follow", "true")
	}
	path := "/api/v1/namespaces/" + url.PathEscape(namespace) + "/pods/" + url.PathEscape(pod) + "/log"
	return k.stream(ctx, path, query)
}

func summarize(resource routeDefinition, object map[string]interface{}) resourceItem {
	created := parseTime(stringAt(object, "metadata", "creationTimestamp"))
	event := resourceItem{
		Name:      stringAt(object, "metadata", "name"),
		Namespace: stringAt(object, "metadata", "namespace"),
		Kind:      resource.Kind,
		Age:       shortAge(time.Since(created)),
		CreatedAt: created,
		Labels:    stringMapAt(object, "metadata", "labels"),
	}
	switch resource.Key {
	case "pods":
		phase := stringAt(object, "status", "phase")
		reason := ""
		ready := 0
		containers := sliceAt(object, "spec", "containers")
		for _, raw := range sliceAt(object, "status", "containerStatuses") {
			status, _ := raw.(map[string]interface{})
			if booleanAt(status, "ready") {
				ready++
			}
			event.Restarts += intAt(status, "restartCount")
			for _, stateName := range []string{"waiting", "terminated"} {
				candidate := stringAt(status, "state", stateName, "reason")
				if candidate != "" && candidate != "Completed" {
					reason = candidate
				}
			}
		}
		event.Ready = fmt.Sprintf("%d/%d", ready, len(containers))
		event.Status = phase
		if reason != "" {
			event.Status = reason
		}
		event.StatusTone = podTone(phase, reason, event.Ready)
		event.Node = stringAt(object, "spec", "nodeName")
		event.IP = stringAt(object, "status", "podIP")
		event.ImageCount = len(containers)
		if len(containers) > 0 {
			container, _ := containers[0].(map[string]interface{})
			event.Image = stringAt(container, "image")
		}
	case "deployments", "statefulsets", "replicasets":
		desired := intAt(object, "spec", "replicas")
		if _, exists := mapAt(object, "spec")["replicas"]; !exists {
			desired = 1
		}
		ready := intAt(object, "status", "readyReplicas")
		available := intAt(object, "status", "availableReplicas")
		updated := intAt(object, "status", "updatedReplicas")
		event.Ready = fmt.Sprintf("%d/%d", ready, desired)
		event.Status = "Running"
		event.StatusTone = "success"
		if ready < desired || available < desired {
			event.Status = "Progressing"
			event.StatusTone = "warning"
		}
		if desired == 0 {
			event.Status = "Scaled to zero"
			event.StatusTone = "neutral"
		}
		event.Detail = fmt.Sprintf("已更新 %d · 可用 %d", updated, available)
		containers := sliceAt(object, "spec", "template", "spec", "containers")
		event.ImageCount = len(containers)
		if len(containers) > 0 {
			container, _ := containers[0].(map[string]interface{})
			event.Image = stringAt(container, "image")
		}
	case "daemonsets":
		desired := intAt(object, "status", "desiredNumberScheduled")
		ready := intAt(object, "status", "numberReady")
		event.Ready = fmt.Sprintf("%d/%d", ready, desired)
		event.Status = "Running"
		event.StatusTone = "success"
		if ready < desired {
			event.Status = "Progressing"
			event.StatusTone = "warning"
		}
		containers := sliceAt(object, "spec", "template", "spec", "containers")
		event.ImageCount = len(containers)
		if len(containers) > 0 {
			container, _ := containers[0].(map[string]interface{})
			event.Image = stringAt(container, "image")
		}
	case "jobs":
		active := intAt(object, "status", "active")
		succeeded := intAt(object, "status", "succeeded")
		failed := intAt(object, "status", "failed")
		completions := intAt(object, "spec", "completions")
		if completions == 0 {
			completions = 1
		}
		event.Ready = fmt.Sprintf("%d/%d", succeeded, completions)
		event.Status = "Running"
		event.StatusTone = "info"
		if succeeded >= completions {
			event.Status = "Complete"
			event.StatusTone = "success"
		}
		if failed > 0 {
			event.Status = "Failed"
			event.StatusTone = "danger"
		}
		event.Detail = fmt.Sprintf("活动 %d · 失败 %d", active, failed)
	case "cronjobs":
		event.Detail = stringAt(object, "spec", "schedule")
		event.Ready = fmt.Sprintf("%d 个活动任务", len(sliceAt(object, "status", "active")))
		event.Status = "Scheduled"
		event.StatusTone = "success"
		if booleanAt(object, "spec", "suspend") {
			event.Status = "Suspended"
			event.StatusTone = "neutral"
		}
	case "services":
		event.Type = stringAt(object, "spec", "type")
		event.Status = event.Type
		event.StatusTone = "info"
		event.IP = stringAt(object, "spec", "clusterIP")
		ports := make([]string, 0)
		for _, raw := range sliceAt(object, "spec", "ports") {
			port, _ := raw.(map[string]interface{})
			ports = append(ports, fmt.Sprintf("%d/%s", intAt(port, "port"), stringAt(port, "protocol")))
		}
		event.Detail = strings.Join(ports, ", ")
	case "ingresses":
		hosts := make([]string, 0)
		for _, raw := range sliceAt(object, "spec", "rules") {
			rule, _ := raw.(map[string]interface{})
			if host := stringAt(rule, "host"); host != "" {
				hosts = append(hosts, host)
			}
		}
		event.Detail = strings.Join(hosts, ", ")
		event.Status = "Active"
		event.StatusTone = "success"
	case "networkpolicies":
		event.Detail = strings.Join(stringSliceAt(object, "spec", "policyTypes"), " · ")
		event.Status = "Active"
		event.StatusTone = "success"
	case "endpointslices":
		event.Ready = fmt.Sprintf("%d 个端点", len(sliceAt(object, "endpoints")))
		event.Status = "Ready"
		event.StatusTone = "success"
	case "configmaps", "secrets":
		keys := map[string]bool{}
		for _, field := range []string{"data", "binaryData", "stringData"} {
			for key := range mapAt(object, field) {
				keys[key] = true
			}
		}
		event.Ready = fmt.Sprintf("%d 个键", len(keys))
		event.Status = "Configured"
		event.StatusTone = "neutral"
	case "persistentvolumeclaims":
		phase := stringAt(object, "status", "phase")
		event.Status = phase
		event.StatusTone = phaseTone(phase)
		event.Ready = stringAt(object, "status", "capacity", "storage")
		event.Detail = stringAt(object, "spec", "storageClassName")
		event.Node = stringAt(object, "spec", "volumeName")
	case "persistentvolumes":
		phase := stringAt(object, "status", "phase")
		event.Status = phase
		event.StatusTone = phaseTone(phase)
		event.Ready = stringAt(object, "spec", "capacity", "storage")
		event.Detail = stringAt(object, "spec", "storageClassName")
		event.Node = stringAt(object, "spec", "claimRef", "name")
	case "storageclasses":
		event.Status = "Available"
		event.StatusTone = "success"
		event.Detail = stringAt(object, "provisioner")
		event.Ready = stringAt(object, "reclaimPolicy")
	case "nodes":
		event.IP = ""
		for _, raw := range sliceAt(object, "status", "addresses") {
			address, _ := raw.(map[string]interface{})
			if stringAt(address, "type") == "InternalIP" {
				event.IP = stringAt(address, "address")
			}
		}
		event.Status = "NotReady"
		event.StatusTone = "danger"
		for _, raw := range sliceAt(object, "status", "conditions") {
			condition, _ := raw.(map[string]interface{})
			if stringAt(condition, "type") == "Ready" && stringAt(condition, "status") == "True" {
				event.Status = "Ready"
				event.StatusTone = "success"
			}
		}
		event.Image = stringAt(object, "status", "nodeInfo", "kubeletVersion")
		roles := make([]string, 0)
		for key := range event.Labels {
			if strings.HasPrefix(key, "node-role.kubernetes.io/") {
				role := strings.TrimPrefix(key, "node-role.kubernetes.io/")
				if role != "" {
					roles = append(roles, role)
				}
			}
		}
		sort.Strings(roles)
		event.Detail = strings.Join(roles, ", ")
	case "namespaces":
		event.Status = stringAt(object, "status", "phase")
		event.StatusTone = "success"
		if event.Status != "Active" {
			event.StatusTone = "warning"
		}
	default:
		event.Status = "Active"
		event.StatusTone = "neutral"
	}
	return event
}

func sanitizeResource(resource routeDefinition, object map[string]interface{}) {
	if metadata, ok := object["metadata"].(map[string]interface{}); ok {
		delete(metadata, "managedFields")
	}
	if resource.Key == "secrets" {
		delete(object, "data")
		delete(object, "stringData")
	}
}

func nodeReady(node map[string]interface{}) bool {
	for _, raw := range sliceAt(node, "status", "conditions") {
		condition, _ := raw.(map[string]interface{})
		if stringAt(condition, "type") == "Ready" {
			return stringAt(condition, "status") == "True"
		}
	}
	return false
}

func toneRank(tone string) int {
	switch tone {
	case "danger":
		return 0
	case "warning":
		return 1
	case "info":
		return 2
	case "success":
		return 3
	default:
		return 4
	}
}

func podTone(phase, reason, ready string) string {
	if phase == "Failed" || reason == "CrashLoopBackOff" || reason == "ImagePullBackOff" || reason == "ErrImagePull" || reason == "OOMKilled" {
		return "danger"
	}
	if phase == "Pending" || phase == "Unknown" || strings.HasPrefix(ready, "0/") || reason == "ContainerCreating" {
		return "warning"
	}
	return "success"
}

func phaseTone(phase string) string {
	switch phase {
	case "Bound", "Available":
		return "success"
	case "Pending", "Released":
		return "warning"
	case "Lost", "Failed":
		return "danger"
	default:
		return "neutral"
	}
}

func shortAge(duration time.Duration) string {
	if duration < 0 {
		duration = 0
	}
	seconds := int64(duration.Seconds())
	switch {
	case seconds < 60:
		return fmt.Sprintf("%ds", seconds)
	case seconds < 3600:
		return fmt.Sprintf("%dm", seconds/60)
	case seconds < 86400:
		return fmt.Sprintf("%dh", seconds/3600)
	default:
		return fmt.Sprintf("%dd", seconds/86400)
	}
}

func quantityCPU(value string) float64 {
	value = strings.TrimSpace(value)
	unitMultiplier := float64(1)
	if strings.HasSuffix(value, "n") {
		unitMultiplier = 1e-9
		value = strings.TrimSuffix(value, "n")
	} else if strings.HasSuffix(value, "u") {
		unitMultiplier = 1e-6
		value = strings.TrimSuffix(value, "u")
	} else if strings.HasSuffix(value, "m") {
		unitMultiplier = 1e-3
		value = strings.TrimSuffix(value, "m")
	}
	number, _ := strconv.ParseFloat(value, 64)
	return number * unitMultiplier
}

func quantityMemory(value string) int64 {
	value = strings.TrimSpace(value)
	multipliers := []struct {
		Suffix     string
		Multiplier float64
	}{
		{"Pi", 1 << 50},
		{"Ti", 1 << 40},
		{"Gi", 1 << 30},
		{"Mi", 1 << 20},
		{"Ki", 1 << 10},
		{"P", 1e15},
		{"T", 1e12},
		{"G", 1e9},
		{"M", 1e6},
		{"K", 1e3},
	}
	for _, entry := range multipliers {
		if strings.HasSuffix(value, entry.Suffix) {
			number, _ := strconv.ParseFloat(strings.TrimSuffix(value, entry.Suffix), 64)
			return int64(number * entry.Multiplier)
		}
	}
	number, _ := strconv.ParseFloat(value, 64)
	return int64(number)
}

func parseTime(value string) time.Time {
	parsed, _ := time.Parse(time.RFC3339, value)
	return parsed
}

func mapAt(object map[string]interface{}, keys ...string) map[string]interface{} {
	var current interface{} = object
	for _, key := range keys {
		value, ok := current.(map[string]interface{})
		if !ok {
			return map[string]interface{}{}
		}
		current = value[key]
	}
	result, _ := current.(map[string]interface{})
	if result == nil {
		return map[string]interface{}{}
	}
	return result
}

func stringAt(object map[string]interface{}, keys ...string) string {
	var current interface{} = object
	for _, key := range keys {
		value, ok := current.(map[string]interface{})
		if !ok {
			return ""
		}
		current = value[key]
	}
	value, _ := current.(string)
	return value
}

func intAt(object map[string]interface{}, keys ...string) int64 {
	var current interface{} = object
	for _, key := range keys {
		value, ok := current.(map[string]interface{})
		if !ok {
			return 0
		}
		current = value[key]
	}
	switch value := current.(type) {
	case float64:
		return int64(math.Round(value))
	case int64:
		return value
	case json.Number:
		result, _ := value.Int64()
		return result
	default:
		return 0
	}
}

func booleanAt(object map[string]interface{}, keys ...string) bool {
	var current interface{} = object
	for _, key := range keys {
		value, ok := current.(map[string]interface{})
		if !ok {
			return false
		}
		current = value[key]
	}
	value, _ := current.(bool)
	return value
}

func sliceAt(object map[string]interface{}, keys ...string) []interface{} {
	var current interface{} = object
	for _, key := range keys {
		value, ok := current.(map[string]interface{})
		if !ok {
			return nil
		}
		current = value[key]
	}
	value, _ := current.([]interface{})
	return value
}

func stringSliceAt(object map[string]interface{}, keys ...string) []string {
	result := make([]string, 0)
	for _, raw := range sliceAt(object, keys...) {
		if value, ok := raw.(string); ok {
			result = append(result, value)
		}
	}
	return result
}

func stringMapAt(object map[string]interface{}, keys ...string) map[string]string {
	result := make(map[string]string)
	for key, value := range mapAt(object, keys...) {
		if text, ok := value.(string); ok {
			result[key] = text
		}
	}
	return result
}
