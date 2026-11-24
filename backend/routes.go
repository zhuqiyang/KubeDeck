package main

import "net/http"

type routeDefinition struct {
	Key        string `json:"key"`
	Kind       string `json:"kind"`
	Label      string `json:"label"`
	Group      string `json:"group"`
	Version    string `json:"version"`
	Plural     string `json:"plural"`
	Namespaced bool   `json:"namespaced"`
	Category   string `json:"category"`
}

var resources = []routeDefinition{
	{Key: "deployments", Kind: "Deployment", Label: "Deployments", Group: "apps", Version: "v1", Plural: "deployments", Namespaced: true, Category: "workloads"},
	{Key: "statefulsets", Kind: "StatefulSet", Label: "StatefulSets", Group: "apps", Version: "v1", Plural: "statefulsets", Namespaced: true, Category: "workloads"},
	{Key: "daemonsets", Kind: "DaemonSet", Label: "DaemonSets", Group: "apps", Version: "v1", Plural: "daemonsets", Namespaced: true, Category: "workloads"},
	{Key: "replicasets", Kind: "ReplicaSet", Label: "ReplicaSets", Group: "apps", Version: "v1", Plural: "replicasets", Namespaced: true, Category: "workloads"},
	{Key: "jobs", Kind: "Job", Label: "Jobs", Group: "batch", Version: "v1", Plural: "jobs", Namespaced: true, Category: "workloads"},
	{Key: "cronjobs", Kind: "CronJob", Label: "CronJobs", Group: "batch", Version: "v1", Plural: "cronjobs", Namespaced: true, Category: "workloads"},
	{Key: "pods", Kind: "Pod", Label: "Pods", Group: "", Version: "v1", Plural: "pods", Namespaced: true, Category: "workloads"},
	{Key: "services", Kind: "Service", Label: "Services", Group: "", Version: "v1", Plural: "services", Namespaced: true, Category: "network"},
	{Key: "ingresses", Kind: "Ingress", Label: "Ingresses", Group: "networking.k8s.io", Version: "v1", Plural: "ingresses", Namespaced: true, Category: "network"},
	{Key: "networkpolicies", Kind: "NetworkPolicy", Label: "NetworkPolicies", Group: "networking.k8s.io", Version: "v1", Plural: "networkpolicies", Namespaced: true, Category: "network"},
	{Key: "endpointslices", Kind: "EndpointSlice", Label: "EndpointSlices", Group: "discovery.k8s.io", Version: "v1", Plural: "endpointslices", Namespaced: true, Category: "network"},
	{Key: "configmaps", Kind: "ConfigMap", Label: "ConfigMaps", Group: "", Version: "v1", Plural: "configmaps", Namespaced: true, Category: "config"},
	{Key: "secrets", Kind: "Secret", Label: "Secrets", Group: "", Version: "v1", Plural: "secrets", Namespaced: true, Category: "config"},
	{Key: "persistentvolumeclaims", Kind: "PersistentVolumeClaim", Label: "PVCs", Group: "", Version: "v1", Plural: "persistentvolumeclaims", Namespaced: true, Category: "storage"},
	{Key: "persistentvolumes", Kind: "PersistentVolume", Label: "PVs", Group: "", Version: "v1", Plural: "persistentvolumes", Namespaced: false, Category: "storage"},
	{Key: "storageclasses", Kind: "StorageClass", Label: "StorageClasses", Group: "storage.k8s.io", Version: "v1", Plural: "storageclasses", Namespaced: false, Category: "storage"},
	{Key: "nodes", Kind: "Node", Label: "Nodes", Group: "", Version: "v1", Plural: "nodes", Namespaced: false, Category: "cluster"},
	{Key: "namespaces", Kind: "Namespace", Label: "Namespaces", Group: "", Version: "v1", Plural: "namespaces", Namespaced: false, Category: "cluster"},
}

var resourcesByKey = func() map[string]routeDefinition {
	result := make(map[string]routeDefinition, len(resources))
	for _, resource := range resources {
		result[resource.Key] = resource
	}
	return result
}()

func resourceForRequest(r *http.Request) (routeDefinition, bool) {
	resource, ok := resourcesByKey[r.URL.Query().Get("kind")]
	return resource, ok
}
