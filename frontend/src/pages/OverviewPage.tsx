import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  Cpu,
  Layers3,
  MemoryStick,
  RefreshCw,
  Server,
} from "lucide-react";
import { Button, Progress, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useShell } from "../context";
import type { ResourceItem } from "../types";
import { StatusBadge } from "../components/StatusBadge";

function formatBytes(value: number) {
  if (!value) return "0 GiB";
  const gib = value / 1024 ** 3;
  return `${gib >= 10 ? gib.toFixed(0) : gib.toFixed(1)} GiB`;
}

function ResourceName({ item, onClick }: { item: ResourceItem; onClick: () => void }) {
  return (
    <button className="link-button resource-name-button" onClick={onClick}>
      <span>{item.name}</span>
      <ArrowUpRight size={13} />
    </button>
  );
}

export function OverviewPage() {
  const { namespace } = useShell();
  const navigate = useNavigate();
  const overviewQuery = useQuery({
    queryKey: ["overview", namespace],
    queryFn: () => api.overview(namespace),
    refetchInterval: 30_000,
  });
  const data = overviewQuery.data;
  const cluster = data?.cluster;
  const cpuPercent = cluster?.cpuAllocatable
    ? Math.min(100, ((data?.cpuUsage ?? 0) / cluster.cpuAllocatable) * 100)
    : 0;
  const memoryPercent = cluster?.memoryAllocatable
    ? Math.min(100, ((data?.memoryUsageBytes ?? 0) / cluster.memoryAllocatable) * 100)
    : 0;
  const deployPercent = cluster?.deployments
    ? Math.round((cluster.deployReady / cluster.deployments) * 100)
    : 100;
  const warningCount = (data?.unhealthyPods.length ?? 0) + (data?.recentEvents.filter((item) => item.type === "Warning").length ?? 0);

  const workloadColumns: ColumnsType<ResourceItem> = [
    {
      title: "工作负载",
      dataIndex: "name",
      render: (_, item) => (
        <ResourceName item={item} onClick={() => navigate(`/resources/deployments?focus=${encodeURIComponent(item.name)}`)} />
      ),
    },
    {
      title: "命名空间",
      dataIndex: "namespace",
      width: 140,
      render: (value: string) => <span className="mono-cell">{value}</span>,
    },
    {
      title: "状态",
      width: 130,
      render: (_, item) => <StatusBadge tone={item.statusTone}>{item.status}</StatusBadge>,
    },
    {
      title: "就绪",
      dataIndex: "ready",
      width: 90,
      align: "right",
      render: (value: string) => <b className="mono-cell">{value || "—"}</b>,
    },
    { title: "运行时长", dataIndex: "age", width: 90, align: "right" },
  ];

  const podColumns: ColumnsType<ResourceItem> = [
    {
      title: "Pod",
      dataIndex: "name",
      render: (_, item) => (
        <ResourceName item={item} onClick={() => navigate(`/resources/pods?focus=${encodeURIComponent(item.name)}`)} />
      ),
    },
    {
      title: "命名空间",
      dataIndex: "namespace",
      width: 130,
      render: (value: string) => <span className="mono-cell">{value}</span>,
    },
    {
      title: "状态",
      width: 150,
      render: (_, item) => <StatusBadge tone={item.statusTone}>{item.status}</StatusBadge>,
    },
    {
      title: "重启",
      dataIndex: "restarts",
      width: 72,
      align: "right",
      render: (value: number) => <span className={value > 0 ? "restart-count" : ""}>{value}</span>,
    },
    { title: "节点", dataIndex: "node", width: 120, ellipsis: true },
  ];

  return (
    <div className="page-stack">
      <div className="page-heading overview-heading">
        <div>
          <span className="eyebrow">CLUSTER PULSE</span>
          <h1>集群总览</h1>
          <p>
            {cluster ? `${cluster.version || "Kubernetes"} · ${cluster.nodesTotal} 个节点 · ${cluster.namespaces} 个命名空间` : "正在读取集群状态"}
          </p>
        </div>
        <div className="heading-actions">
          <span className="last-updated">
            更新于 {overviewQuery.dataUpdatedAt ? dayjs(overviewQuery.dataUpdatedAt).format("HH:mm:ss") : "—"}
          </span>
          <Button icon={<RefreshCw size={15} />} loading={overviewQuery.isFetching} onClick={() => overviewQuery.refetch()}>
            刷新
          </Button>
        </div>
      </div>

      {warningCount > 0 ? (
        <div className="attention-strip">
          <span className="attention-icon">
            <AlertTriangle size={17} />
          </span>
          <div>
            <b>{warningCount} 项运行信号需要关注</b>
            <span>优先检查异常 Pod 和 Warning 事件，避免影响后续发布。</span>
          </div>
          <button onClick={() => navigate("/events")}>
            查看事件 <ArrowUpRight size={14} />
          </button>
        </div>
      ) : null}

      <section className="metric-grid">
        <article className="metric-card">
          <div className="metric-icon metric-icon-green">
            <Server size={19} />
          </div>
          <div className="metric-label">节点健康</div>
          <div className="metric-value">
            {cluster?.nodesReady ?? 0}
            <span>/ {cluster?.nodesTotal ?? 0}</span>
          </div>
          <div className="metric-caption">
            <span className="health-dot online" />
            所有节点已加入调度
          </div>
        </article>
        <article className="metric-card">
          <div className="metric-icon metric-icon-blue">
            <Boxes size={19} />
          </div>
          <div className="metric-label">Pod 运行</div>
          <div className="metric-value">
            {cluster?.podsRunning ?? 0}
            <span>/ {cluster?.podsTotal ?? 0}</span>
          </div>
          <div className="metric-caption">
            {cluster?.podsPending ?? 0} 等待中 · {cluster?.podsFailed ?? 0} 失败
          </div>
        </article>
        <article className="metric-card">
          <div className="metric-icon metric-icon-teal">
            <Layers3 size={19} />
          </div>
          <div className="metric-label">工作负载就绪</div>
          <div className="metric-value">
            {deployPercent}
            <span>%</span>
          </div>
          <div className="metric-caption">
            {cluster?.deployReady ?? 0} / {cluster?.deployments ?? 0} 个 Deployment
          </div>
        </article>
        <article className="metric-card">
          <div className="metric-icon metric-icon-amber">
            <Activity size={19} />
          </div>
          <div className="metric-label">CPU 使用率</div>
          <div className="metric-value">
            {data?.metricsAvailable ? cpuPercent.toFixed(1) : "—"}
            <span>{data?.metricsAvailable ? "%" : ""}</span>
          </div>
          <div className="metric-caption">
            {data?.metricsAvailable
              ? `${(data.cpuUsage ?? 0).toFixed(2)} / ${(cluster?.cpuAllocatable ?? 0).toFixed(1)} cores`
              : "Metrics Server 暂无数据"}
          </div>
        </article>
      </section>

      <section className="dashboard-grid">
        <div className="panel panel-span-2">
          <div className="panel-heading">
            <div>
              <h2>工作负载健康</h2>
              <p>当前 Namespace 下的 Deployment 状态</p>
            </div>
            <button className="link-button panel-link" onClick={() => navigate("/resources/deployments")}>
              查看全部 <ArrowUpRight size={14} />
            </button>
          </div>
          <Table
            rowKey={(item) => `${item.namespace}/${item.name}`}
            columns={workloadColumns}
            dataSource={data?.workloads ?? []}
            loading={overviewQuery.isLoading}
            pagination={false}
            size="middle"
            scroll={{ x: 620 }}
          />
        </div>
        <div className="panel capacity-panel">
          <div className="panel-heading">
            <div>
              <h2>集群容量</h2>
              <p>实体资源实时占用</p>
            </div>
            <span className="panel-icon">
              <Cpu size={17} />
            </span>
          </div>
          <div className="capacity-block">
            <div className="capacity-title">
              <span>
                <Cpu size={15} /> CPU
              </span>
              <b>{cpuPercent.toFixed(1)}%</b>
            </div>
            <Progress percent={cpuPercent} showInfo={false} strokeColor="#2563eb" trailColor="var(--track)" />
            <div className="capacity-meta">
              <span>{(data?.cpuUsage ?? 0).toFixed(2)} cores 已用</span>
              <span>{(cluster?.cpuAllocatable ?? 0).toFixed(1)} cores 可分配</span>
            </div>
          </div>
          <div className="capacity-block">
            <div className="capacity-title">
              <span>
                <MemoryStick size={15} /> 内存
              </span>
              <b>{memoryPercent.toFixed(1)}%</b>
            </div>
            <Progress percent={memoryPercent} showInfo={false} strokeColor="#0f766e" trailColor="var(--track)" />
            <div className="capacity-meta">
              <span>{formatBytes(data?.memoryUsageBytes ?? 0)} 已用</span>
              <span>{formatBytes(cluster?.memoryAllocatable ?? 0)} 可分配</span>
            </div>
          </div>
          <div className="capacity-summary">
            <div>
              <b>{cluster?.services ?? 0}</b>
              <span>Services</span>
            </div>
            <div>
              <b>{cluster?.namespaces ?? 0}</b>
              <span>Namespaces</span>
            </div>
            <div>
              <b>{cluster?.nodesTotal ?? 0}</b>
              <span>Nodes</span>
            </div>
          </div>
        </div>
      </section>

      <section className="dashboard-grid lower-grid">
        <div className="panel panel-span-2">
          <div className="panel-heading">
            <div>
              <h2>需要关注的 Pod</h2>
              <p>按危险程度和重启次数排序</p>
            </div>
            <button className="link-button panel-link" onClick={() => navigate("/resources/pods")}>
              查看全部 <ArrowUpRight size={14} />
            </button>
          </div>
          <Table
            rowKey={(item) => `${item.namespace}/${item.name}`}
            columns={podColumns}
            dataSource={data?.unhealthyPods ?? []}
            loading={overviewQuery.isLoading}
            pagination={false}
            size="middle"
            locale={{ emptyText: "没有异常 Pod" }}
            scroll={{ x: 620 }}
          />
        </div>
        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2>近期事件</h2>
              <p>最新调度与健康信号</p>
            </div>
            <button className="link-button panel-link" onClick={() => navigate("/events")}>
              事件中心 <ArrowUpRight size={14} />
            </button>
          </div>
          <div className="event-feed">
            {(data?.recentEvents ?? []).slice(0, 7).map((event) => (
              <button key={event.id} className="event-feed-item" onClick={() => navigate("/events")}>
                <span className={`event-marker ${event.type === "Warning" ? "warning" : ""}`} />
                <span className="event-feed-copy">
                  <b>{event.reason}</b>
                  <span>
                    {event.objectKind} / {event.objectName}
                  </span>
                </span>
                <time>{event.age}</time>
              </button>
            ))}
            {!data?.recentEvents.length ? <div className="feed-empty">暂无近期事件</div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
