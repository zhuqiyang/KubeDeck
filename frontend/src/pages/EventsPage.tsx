import { Button, Input, Segmented, Space, Table, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { AlertTriangle, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useShell } from "../context";
import type { EventItem } from "../types";
import { StatusBadge, KindIcon } from "../components/StatusBadge";

export function EventsPage() {
  const { namespace, bootstrap } = useShell();
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"all" | "Warning" | "Normal">("all");
  const navigate = useNavigate();
  const eventsQuery = useQuery({
    queryKey: ["events", namespace],
    queryFn: () => api.events(namespace, 500),
    refetchInterval: 30_000,
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (eventsQuery.data ?? []).filter((event) => {
      if (type !== "all" && event.type !== type) return false;
      if (!term) return true;
      return `${event.reason} ${event.message} ${event.objectName} ${event.namespace}`
        .toLowerCase()
        .includes(term);
    });
  }, [eventsQuery.data, search, type]);

  function openObject(event: EventItem) {
    const kindMap: Record<string, string> = {
      Pod: "pods",
      Deployment: "deployments",
      StatefulSet: "statefulsets",
      DaemonSet: "daemonsets",
      ReplicaSet: "replicasets",
      Job: "jobs",
      CronJob: "cronjobs",
      Service: "services",
      Ingress: "ingresses",
      Node: "nodes",
      PersistentVolumeClaim: "persistentvolumeclaims",
    };
    const key = kindMap[event.objectKind];
    if (!key) return;
    const exists = bootstrap.catalog.some((resource) => resource.key === key);
    if (exists) navigate(`/resources/${key}?focus=${encodeURIComponent(event.objectName)}`);
  }

  const columns: ColumnsType<EventItem> = [
    {
      title: "级别",
      dataIndex: "type",
      width: 100,
      render: (value: string) => (
        <StatusBadge tone={value === "Warning" ? "warning" : "info"}>{value}</StatusBadge>
      ),
    },
    {
      title: "原因",
      dataIndex: "reason",
      width: 170,
      render: (value: string) => <span className="strong-cell">{value || "Unknown"}</span>,
    },
    {
      title: "对象",
      width: 230,
      render: (_, event) => (
        <button className="link-button object-link" onClick={() => openObject(event)}>
          <KindIcon kind={event.objectKind} size={14} />
          <span>{event.objectKind}</span>
          <b>{event.objectName}</b>
        </button>
      ),
    },
    {
      title: "命名空间",
      dataIndex: "namespace",
      width: 150,
      render: (value: string) => <span className="mono-cell">{value || "—"}</span>,
    },
    {
      title: "消息",
      dataIndex: "message",
      ellipsis: { showTitle: false },
      render: (value: string) => (
        <Tooltip title={value} placement="bottomLeft">
          <span className="message-cell">{value}</span>
        </Tooltip>
      ),
    },
    {
      title: "次数",
      dataIndex: "count",
      width: 72,
      align: "right",
    },
    {
      title: "最后发生",
      dataIndex: "age",
      width: 100,
      align: "right",
    },
  ];

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">CLUSTER SIGNALS</span>
          <h1>事件中心</h1>
          <p>聚合调度、镜像、探针和控制器产生的关键事件。</p>
        </div>
        <Button
          icon={<RefreshCw size={15} />}
          loading={eventsQuery.isFetching}
          onClick={() => eventsQuery.refetch()}
        >
          刷新
        </Button>
      </div>
      <div className="table-panel">
        <div className="table-toolbar">
          <Space size={10} wrap>
            <Input
              allowClear
              prefix={<Search size={15} />}
              placeholder="搜索原因、对象或消息"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{ width: 310 }}
            />
            <Segmented
              value={type}
              onChange={(value) => setType(value as typeof type)}
              options={[
                { label: "全部", value: "all" },
                { label: "警告", value: "Warning" },
                { label: "常规", value: "Normal" },
              ]}
            />
          </Space>
          <div className="table-meta">
            <AlertTriangle size={15} />
            {filtered.filter((event) => event.type === "Warning").length} 条警告 · 共 {filtered.length} 条
          </div>
        </div>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={eventsQuery.isLoading}
          size="middle"
          scroll={{ x: 1120 }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
        />
      </div>
    </div>
  );
}
