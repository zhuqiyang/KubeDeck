import type {
  AuthStatus,
  Bootstrap,
  EventItem,
  KubeObject,
  OverviewData,
  ResourceList,
} from "./types";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    ...init,
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const message =
      typeof body === "object" && body && "error" in body
        ? String((body as { error: string }).error)
        : `请求失败 (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return body as T;
}

function withNamespace(namespace: string) {
  return namespace ? `&namespace=${encodeURIComponent(namespace)}` : "";
}

export const api = {
  authStatus: () => request<AuthStatus>("/api/auth/status"),
  login: (password: string) =>
    request<{ ok: boolean }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  bootstrap: () => request<Bootstrap>("/api/bootstrap"),
  overview: (namespace: string) =>
    request<OverviewData>(`/api/overview?namespace=${encodeURIComponent(namespace || "_all")}`),
  resources: (kind: string, namespace: string, search = "") =>
    request<ResourceList>(
      `/api/resources?kind=${encodeURIComponent(kind)}${withNamespace(namespace)}&search=${encodeURIComponent(search)}`,
    ),
  resource: (kind: string, namespace: string, name: string) =>
    request<KubeObject>(
      `/api/resource?kind=${encodeURIComponent(kind)}${withNamespace(namespace)}&name=${encodeURIComponent(name)}`,
    ),
  updateResource: (kind: string, namespace: string, name: string, object: KubeObject, dryRun = false) =>
    request<{ ok: boolean }>(
      `/api/resource?kind=${encodeURIComponent(kind)}${withNamespace(namespace)}&name=${encodeURIComponent(name)}&dryRun=${dryRun}`,
      { method: "PUT", body: JSON.stringify({ object }) },
    ),
  events: (namespace: string, limit = 100) =>
    request<EventItem[]>(
      `/api/events?namespace=${encodeURIComponent(namespace || "_all")}&limit=${limit}`,
    ),
  action: (payload: {
    action: "restart" | "scale" | "delete";
    kind: string;
    namespace?: string;
    name: string;
    replicas?: number;
  }) =>
    request<{ ok: boolean }>("/api/action", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

export function createLogStream(options: {
  namespace: string;
  pod: string;
  container?: string;
  tailLines: number;
  follow: boolean;
  onLine: (line: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}) {
  const params = new URLSearchParams({
    namespace: options.namespace,
    pod: options.pod,
    tailLines: String(options.tailLines),
    follow: String(options.follow),
  });
  if (options.container) params.set("container", options.container);
  const stream = new EventSource(`/api/logs?${params.toString()}`);
  stream.addEventListener("log", (event) => {
    try {
      options.onLine(JSON.parse((event as MessageEvent).data));
    } catch {
      options.onLine((event as MessageEvent).data);
    }
  });
  stream.addEventListener("error", (event) => {
    if ((event as MessageEvent).data) {
      try {
        options.onError(JSON.parse((event as MessageEvent).data));
      } catch {
        options.onError("日志流连接失败");
      }
    }
  });
  stream.addEventListener("end", () => {
    options.onEnd();
    stream.close();
  });
  stream.onerror = () => {
    if (stream.readyState === EventSource.CLOSED) {
      options.onEnd();
    }
  };
  return stream;
}
