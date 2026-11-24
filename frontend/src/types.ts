export interface ApiErrorShape {
  error?: string;
}

export interface AuthStatus {
  authenticated: boolean;
  authDisabled: boolean;
  clusterName: string;
}

export interface ResourceDefinition {
  key: string;
  kind: string;
  label: string;
  group: string;
  version: string;
  plural: string;
  namespaced: boolean;
  category: "workloads" | "network" | "config" | "storage" | "cluster";
}

export interface Bootstrap {
  clusterName: string;
  namespaces: string[];
  catalog: ResourceDefinition[];
}

export interface ResourceItem {
  name: string;
  namespace?: string;
  kind: string;
  status: string;
  statusTone: "success" | "warning" | "danger" | "info" | "neutral";
  ready?: string;
  restarts: number;
  age: string;
  createdAt: string;
  node?: string;
  image?: string;
  imageCount?: number;
  ip?: string;
  type?: string;
  detail?: string;
  labels?: Record<string, string>;
}

export interface ResourceList {
  items: ResourceItem[];
  total: number;
}

export interface EventItem {
  id: string;
  type: string;
  reason: string;
  message: string;
  namespace: string;
  objectKind: string;
  objectName: string;
  count: number;
  lastTimestamp: string;
  age: string;
}

export interface ClusterSummary {
  version: string;
  name: string;
  nodesReady: number;
  nodesTotal: number;
  podsRunning: number;
  podsPending: number;
  podsFailed: number;
  podsTotal: number;
  deployments: number;
  deployReady: number;
  services: number;
  namespaces: number;
  cpuAllocatable: number;
  memoryAllocatable: number;
}

export interface OverviewData {
  cluster: ClusterSummary;
  unhealthyPods: ResourceItem[];
  workloads: ResourceItem[];
  recentEvents: EventItem[];
  cpuUsage: number;
  memoryUsageBytes: number;
  metricsAvailable: boolean;
}

export type KubeObject = Record<string, unknown> & {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    creationTimestamp?: string;
    resourceVersion?: string;
  };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
};
