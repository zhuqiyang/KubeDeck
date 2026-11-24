package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const sessionCookie = "kubedeck_session"

type sessionManager struct {
	secret []byte
	ttl    time.Duration
}

func newSessionManager(secret string, ttl time.Duration) *sessionManager {
	return &sessionManager{secret: []byte(secret), ttl: ttl}
}

func (s *sessionManager) create() (string, error) {
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	payload := strconv.FormatInt(time.Now().Add(s.ttl).Unix(), 10) + "." + hex.EncodeToString(nonce)
	return payload + "." + s.sign(payload), nil
}

func (s *sessionManager) validate(value string) bool {
	parts := strings.Split(value, ".")
	if len(parts) != 3 {
		return false
	}
	payload := parts[0] + "." + parts[1]
	if !hmac.Equal([]byte(s.sign(payload)), []byte(parts[2])) {
		return false
	}
	expires, err := strconv.ParseInt(parts[0], 10, 64)
	return err == nil && time.Now().Unix() < expires
}

func (s *sessionManager) sign(payload string) string {
	mac := hmac.New(sha256.New, s.secret)
	_, _ = mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *sessionManager) authenticated(r *http.Request) bool {
	cookie, err := r.Cookie(sessionCookie)
	return err == nil && s.validate(cookie.Value)
}

func (s *sessionManager) setCookie(w http.ResponseWriter, value string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    value,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(s.ttl.Seconds()),
	})
}

func (s *sessionManager) clearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   -1,
	})
}

type loginLimiter struct {
	mu       sync.Mutex
	attempts map[string]loginAttempt
}

type loginAttempt struct {
	Count     int
	ExpiresAt time.Time
}

func newLoginLimiter() *loginLimiter {
	return &loginLimiter{attempts: make(map[string]loginAttempt)}
}

func (l *loginLimiter) allowed(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	for key, value := range l.attempts {
		if now.After(value.ExpiresAt) {
			delete(l.attempts, key)
		}
	}
	value, exists := l.attempts[ip]
	return !exists || value.Count < 8
}

func (l *loginLimiter) failed(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	value := l.attempts[ip]
	if value.ExpiresAt.IsZero() || time.Now().After(value.ExpiresAt) {
		value = loginAttempt{ExpiresAt: time.Now().Add(15 * time.Minute)}
	}
	value.Count++
	l.attempts[ip] = value
}

func (l *loginLimiter) reset(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.attempts, ip)
}

func equalSecret(expected, actual string) bool {
	if len(expected) != len(actual) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(actual)) == 1
}

func requestIP(r *http.Request) string {
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		ip, _, _ := strings.Cut(forwarded, ",")
		return strings.TrimSpace(ip)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func sameOrigin(origin, host string) bool {
	origin = strings.TrimSuffix(origin, "/")
	return origin == "http://"+host || origin == "https://"+host
}
