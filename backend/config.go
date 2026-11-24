package main

import (
	"errors"
	"os"
	"strconv"
	"time"
)

type config struct {
	Port          string
	Password      string
	SessionSecret string
	SessionTTL    time.Duration
	AuthDisabled  bool
	ClusterName   string
}

func loadConfig() (config, error) {
	ttl := 12 * time.Hour
	if raw := os.Getenv("SESSION_TTL"); raw != "" {
		value, err := time.ParseDuration(raw)
		if err != nil {
			return config{}, err
		}
		ttl = value
	}
	authDisabled, err := strconv.ParseBool(envOr("AUTH_DISABLED", "false"))
	if err != nil {
		return config{}, err
	}
	cfg := config{
		Port:          envOr("PORT", "8080"),
		Password:      envOr("DASHBOARD_PASSWORD", ""),
		SessionSecret: envOr("SESSION_SECRET", ""),
		SessionTTL:    ttl,
		AuthDisabled:  authDisabled,
		ClusterName:   envOr("CLUSTER_NAME", "kube-cluster"),
	}
	if !cfg.AuthDisabled && (cfg.Password == "" || cfg.SessionSecret == "") {
		return config{}, errors.New("DASHBOARD_PASSWORD and SESSION_SECRET are required")
	}
	return cfg, nil
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
