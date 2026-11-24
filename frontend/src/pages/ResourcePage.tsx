import {
  ArrowLeftRight,
  Code2,
  Copy,
  FileCode2,
  ListFilter,
  MoreHorizontal,
  Play,
  RefreshCw,
  RotateCw,
  Search,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import {
  Alert,
  App as AntApp,
  Button,
  Descriptions,
  Drawer,
  Dropdown,
  Empty,
  Input,
  InputNumber,
  Modal,
  Space,
  Table,
  Tabs,
  Tag,
  type MenuProps,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import yaml from "js-yaml";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useShell } from "../context";
import type { KubeObject, ResourceDefinition, ResourceItem } from "../types";
import { KindIcon, StatusBadge } from "../components/StatusBadge";
import { LogsDrawer } from "../components/LogsDrawer";

const descriptions: Record<string, string> = {
  deployments: "声明式管理无状态应用副本、滚动发布和可用性。",
  statefulsets: "管理需要稳定网络标识和持久存储的有状态工作负载。",
  daemonsets: "在每个符合条件的节点上运行系统级 Pod。",
  replicasets: "维护指定数量的 Pod 副本，通常由 Deployment 管理。",
  jobs: "运行一次性任务直到达到成功完成数。",
  cronjobs: "按照 Cron 计划周期性创建 Job。",
  pods: "查看调度、容器状态、日志、事件和生命周期信息。",
  services: "为 Pod 提供稳定网络访问入口和负载均衡。",
  ingresses: "配置 HTTP/HTTPS 路由并由 Ingress Controller 执行。",
  networkpolicies: "声明 Pod 间网络访问策略。",
  endpointslices: "观察 Service 背后的实际网络端点。",
  configmaps: "管理不包含敏感信息的配置键值。",
  secrets: "查看 Secret 元数据和键名，内容默认脱敏。",
  persistentvolumeclaims: "工作负载对持久存储的声明。",
  persistentvolumes: "集群级别的持久存储卷。",
  storageclasses: "定义动态存储供应和回收策略。",
  nodes: "查看节点状态、角色、版本和可调度信息。",
  namespaces: "逻辑隔离集群资源并管理访问边界。",
};

type ActionTarget = ResourceItem | null;

export function ResourcePage() {
  const params = useParams();
  const { namespace, bootstrap } = useShell();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [selected, setSelected] = useState<ResourceItem | null>(null);
  const [editIntent, setEditIntent] = useState(false);
  const [logsPod, setLogsPod] = useState<ResourceItem | null>(null);
  const [scaleTarget, setScaleTarget] = useState<ActionTarget>(null);
  const [scaleValue, setScaleValue] = useState<number>(1);
  const [deleteTarget, setDeleteTarget] = useState<ActionTarget>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const { message, modal } = AntApp.useApp();
  const kind = params.kind ?? "pods";
  const resource = bootstrap.catalog.find((item) => item.key === kind);

  const listQuery = useQuery({
    queryKey: ["resources", kind, namespace, deferredSearch],
    queryFn: () => api.resources(kind, namespace, deferredSearch),
    refetchInterval: kind === "pods" ? 20_000 : false,
    enabled: Boolean(resource),
  });

  useEffect(() => {
    const focus = searchParams.get("focus");
    if (!focus || !listQuery.data) return;
    const match = listQuery.data.items.find((item) => item.name === focus);
    if (match) {
      setSelected(match);
      setSearchParams({}, { replace: true });
    }
  }, [listQuery.data, searchParams, setSearchParams]);

  useEffect(() => {
    setSearch("");
    setSelected(null);
    setEditIntent(false);
  }, [kind]);

  function openDetail(item: ResourceItem, edit = false) {
    setEditIntent(edit);
    setSelected(item);
  }

  function openScale(item: ResourceItem) {
    const desired = Number(item.ready?.split("/")[1]);
    setScaleValue(Number.isFinite(desired) ? desired : 1);
    setScaleTarget(item);
  }

  function openDelete(item: ResourceItem) {
    setDeleteTarget(item);
    setDeleteConfirm("");
  }

  async function refreshAfterAction() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["resources"] }),
      queryClient.invalidateQueries({ queryKey: ["overview"] }),
      queryClient.invalidateQueries({ queryKey: ["events"] }),
    ]);
  }

  async function runRestart(item: ResourceItem) {
    setActionLoading(true);
    try {
      await api.action({
        action: "restart",
        kind,
        namespace: item.namespace,
        name: item.name,
      });
      message.success(`已触发 ${item.name} 滚动重启`);
      await refreshAfterAction();
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      setActionLoading(false);
    }
  }

  async function applyScale() {
    if (!scaleTarget) return;
    setActionLoading(true);
    try {
      await api.action({
        action: "scale",
        kind,
        namespace: scaleTarget.namespace,
        name: scaleTarget.name,
        replicas: scaleValue,
      });
      message.success(`${scaleTarget.name} 已扩缩容到 ${scaleValue} 个副本`);
      setScaleTarget(null);
      await refreshAfterAction();
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : "扩缩容失败");
    } finally {
      setActionLoading(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleteConfirm !== deleteTarget.name) return;
    setActionLoading(true);
    try {
      await api.action({
        action: "delete",
        kind,
        namespace: deleteTarget.namespace,
        name: deleteTarget.name,
      });
      message.success(`${deleteTarget.name} 已删除`);
      if (selected?.name === deleteTarget.name) setSelected(null);
      setDeleteTarget(null);
      await refreshAfterAction();
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : "删除失败");
    } finally {
      setActionLoading(false);
    }
  }

  function actionMenu(item: ResourceItem): MenuProps {
    const items: MenuProps["items"] = [
      { key: "detail", icon: <ListFilter size={14} />, label: "查看详情" },
    ];
    if (kind === "pods") {
      items.push({ key: "logs", icon: <TerminalSquare size={14} />, label: "实时日志" });
    }
    if (scalable(kind)) {
      items.push({ key: "scale", icon: <ArrowLeftRight size={14} />, label: "扩缩容" });
    }
    if (restartable(kind)) {
      items.push({ key: "restart", icon: <RotateCw size={14} />, label: "滚动重启" });
    }
    if (editable(kind)) {
      items.push({ key: "edit", icon: <FileCode2 size={14} />, label: "编辑 YAML" });
    }
    if (deletable(kind)) {
      items.push({ type: "divider" }, { key: "delete", danger: true, icon: <Trash2 size={14} />, label: "删除资源" });
    }
    return {
      items,
      onClick: ({ key, domEvent }) => {
        domEvent.stopPropagation();
        switch (key) {
          case "detail":
            openDetail(item);
            break;
          case "logs":
            setLogsPod(item);
            break;
          case "scale":
            openScale(item);
            break;
          case "restart":
            modal.confirm({
              title: `滚动重启 ${item.name}？`,
              content: "控制器会按发布策略逐步替换 Pod。",
              okText: "确认重启",
              onOk: () => runRestart(item),
            });
            break;
          case "edit":
            openDetail(item, true);
            break;
          case "delete":
            openDelete(item);
            break;
        }
      },
    };
  }

  const columns: ColumnsType<ResourceItem> = useMemo(() => {
    const base: ColumnsType<ResourceItem> = [
      {
        title: resource?.label ?? "名称",
        dataIndex: "name",
        fixed: "left",
        width: 250,
        render: (_, item) => (
          <button className="resource-name" onClick={() => openDetail(item)}>
            <span className="resource-kind-icon">
              <KindIcon kind={item.kind} size={16} />
            </span>
            <span>
              <b>{item.name}</b>
              {item.detail && ["persistentvolumeclaims", "nodes", "storageclasses"].includes(kind) ? (
                <small>{item.detail}</small>
              ) : null}
            </span>
          </button>
        ),
      },
    ];
    if (!namespace && resource?.namespaced) {
      base.push({
        title: "命名空间",
        dataIndex: "namespace",
        width: 155,
        render: (value: string) => <span className="mono-cell">{value}</span>,
      });
    }
    base.push({
      title: "状态",
      dataIndex: "status",
      width: 155,
      render: (_, item) => <StatusBadge tone={item.statusTone}>{item.status || "Unknown"}</StatusBadge>,
    });
    if (["deployments", "statefulsets", "daemonsets", "replicasets", "jobs", "pods", "endpointslices"].includes(kind)) {
      base.push({
        title: kind === "endpointslices" ? "端点" : "就绪",
        dataIndex: "ready",
        width: 90,
        align: "right",
        render: (value: string) => <b className="mono-cell">{value || "—"}</b>,
      });
    }
    if (kind === "pods") {
      base.push({
        title: "重启",
        dataIndex: "restarts",
        width: 72,
        align: "right",
        render: (value: number) => <span className={value > 0 ? "restart-count" : ""}>{value}</span>,
      });
    }
    if (["services", "ingresses", "networkpolicies", "configmaps", "secrets", "persistentvolumeclaims", "persistentvolumes", "storageclasses", "nodes"].includes(kind)) {
      base.push({
        title: "详情",
        dataIndex: kind === "services" ? "ip" : "detail",
        ellipsis: true,
        render: (value: string, item) => (
          <span className="mono-cell">{value || item.type || "—"}</span>
        ),
      });
    }
    if (["deployments", "statefulsets", "daemonsets", "replicasets", "pods"].includes(kind)) {
      base.push({
        title: "镜像",
        dataIndex: "image",
        ellipsis: true,
        render: (value: string, item) => (
          <span className="image-cell" title={value}>
            {value || "—"}
            {item.imageCount && item.imageCount > 1 ? <small>+{item.imageCount - 1}</small> : null}
          </span>
        ),
      });
    }
    if (kind === "pods") {
      base.push({
        title: "节点",
        dataIndex: "node",
        width: 140,
        ellipsis: true,
      });
    }
    base.push(
      { title: "运行时长", dataIndex: "age", width: 104, align: "right" },
      {
        title: "",
        key: "actions",
        width: 54,
        fixed: "right",
        align: "right",
        render: (_, item) => (
          <Dropdown menu={actionMenu(item)} trigger={["click"]}>
            <Button
              type="text"
              size="small"
              icon={<MoreHorizontal size={17} />}
              onClick={(event) => event.stopPropagation()}
            />
          </Dropdown>
        ),
      },
    );
    return base;
  }, [kind, namespace, resource, modal]);

  if (!resource) {
    return <Empty description="未知资源类型" />;
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{resource.category.toUpperCase()}</span>
          <h1>{resource.label}</h1>
          <p>{descriptions[kind] ?? "查看和管理 Kubernetes 资源。"}</p>
        </div>
        <div className="resource-heading-meta">
          <span>{namespace || "全部命名空间"}</span>
          <b>{listQuery.data?.total ?? 0}</b>
        </div>
      </div>
      <div className="table-panel">
        <div className="table-toolbar">
          <Space size={10}>
            <Input
              allowClear
              prefix={<Search size={15} />}
              placeholder={`搜索 ${resource.label}`}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{ width: 300 }}
            />
            <span className="table-scope">
              <span className="scope-dot" />
              {namespace || "全部命名空间"}
            </span>
          </Space>
          <Button icon={<RefreshCw size={15} />} loading={listQuery.isFetching} onClick={() => listQuery.refetch()}>
            刷新
          </Button>
        </div>
        <Table
          rowKey={(item) => `${item.namespace ?? "_"}/${item.name}`}
          columns={columns}
          dataSource={listQuery.data?.items ?? []}
          loading={listQuery.isLoading}
          size="middle"
          scroll={{ x: 1080 }}
          onRow={(item) => ({
            onClick: () => openDetail(item),
            className: "clickable-row",
          })}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total) => `共 ${total} 项`,
          }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前范围内没有资源" /> }}
        />
      </div>

      <ResourceDetailDrawer
        open={Boolean(selected)}
        item={selected}
        kind={kind}
        resource={resource}
        initialEdit={editIntent}
        onClose={() => {
          setSelected(null);
          setEditIntent(false);
        }}
        onLogs={(item) => setLogsPod(item)}
        onScale={openScale}
        onRestart={(item) =>
          modal.confirm({
            title: `滚动重启 ${item.name}？`,
            content: "控制器会按发布策略逐步替换 Pod。",
            okText: "确认重启",
            onOk: () => runRestart(item),
          })
        }
        onDelete={openDelete}
        onChanged={refreshAfterAction}
      />
      <LogsDrawer open={Boolean(logsPod)} pod={logsPod} onClose={() => setLogsPod(null)} />

      <Modal
        open={Boolean(scaleTarget)}
        title={`扩缩容 ${scaleTarget?.name ?? ""}`}
        onCancel={() => setScaleTarget(null)}
        onOk={applyScale}
        okText="应用"
        confirmLoading={actionLoading}
      >
        <div className="form-stack">
          <p className="muted">修改期望副本数，Kubernetes 会逐步收敛到目标状态。</p>
          <label className="field-label">
            目标副本数
            <InputNumber min={0} max={10000} value={scaleValue} onChange={(value) => setScaleValue(value ?? 0)} style={{ width: "100%" }} />
          </label>
        </div>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        title="删除资源"
        okText="确认删除"
        okButtonProps={{ danger: true, disabled: deleteConfirm !== deleteTarget?.name }}
        confirmLoading={actionLoading}
        onOk={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      >
        <Alert
          type="warning"
          showIcon
          message={`即将删除 ${deleteTarget?.namespace ? `${deleteTarget.namespace}/` : ""}${deleteTarget?.name ?? ""}`}
          description="该操作无法从控制台撤销。请确认没有控制器会重新创建它。"
        />
        <label className="field-label delete-confirm">
          输入资源名称以确认
          <Input
            value={deleteConfirm}
            placeholder={deleteTarget?.name}
            onChange={(event) => setDeleteConfirm(event.target.value)}
          />
        </label>
      </Modal>
    </div>
  );
}

function ResourceDetailDrawer({
  open,
  item,
  kind,
  resource,
  initialEdit,
  onClose,
  onLogs,
  onScale,
  onRestart,
  onDelete,
  onChanged,
}: {
  open: boolean;
  item: ResourceItem | null;
  kind: string;
  resource: ResourceDefinition;
  initialEdit: boolean;
  onClose: () => void;
  onLogs: (item: ResourceItem) => void;
  onScale: (item: ResourceItem) => void;
  onRestart: (item: ResourceItem) => void;
  onDelete: (item: ResourceItem) => void;
  onChanged: () => Promise<void>;
}) {
  const { message, modal } = AntApp.useApp();
  const [yamlEditorOpen, setYamlEditorOpen] = useState(false);
  const [yamlText, setYamlText] = useState("");
  const [yamlLoading, setYamlLoading] = useState(false);
  const objectQuery = useQuery({
    queryKey: ["resource-detail", kind, item?.namespace, item?.name],
    queryFn: () => api.resource(kind, item?.namespace ?? "", item?.name ?? ""),
    enabled: open && Boolean(item),
  });
  const eventsQuery = useQuery({
    queryKey: ["resource-events", item?.namespace, item?.name],
    queryFn: () => api.events(item?.namespace ?? "", 500),
    enabled: open && Boolean(item),
  });
  const object = objectQuery.data;
  const yamlValue = useMemo(() => {
    if (!object) return "";
    return yaml.dump(object, { noRefs: true, lineWidth: 120, sortKeys: false });
  }, [object]);
  const relatedEvents = useMemo(
    () => (eventsQuery.data ?? []).filter((event) => event.objectName === item?.name).slice(0, 30),
    [eventsQuery.data, item?.name],
  );

  useEffect(() => {
    if (open && object) setYamlText(yamlValue);
  }, [open, object, yamlValue]);

  useEffect(() => {
    if (open && object && initialEdit) {
      setYamlEditorOpen(true);
    }
  }, [open, object, initialEdit]);

  async function copyYAML() {
    await navigator.clipboard.writeText(yamlValue);
    message.success("YAML 已复制");
  }

  async function validateAndApply() {
    if (!item) return;
    let parsed: unknown;
    try {
      parsed = yaml.load(yamlText);
    } catch (reason) {
      message.error(`YAML 语法错误：${reason instanceof Error ? reason.message : "无法解析"}`);
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      message.error("YAML 必须是一个 Kubernetes 资源对象");
      return;
    }
    const edited = parsed as KubeObject;
    if (edited.metadata?.name !== item.name) {
      message.error("metadata.name 必须与当前资源一致");
      return;
    }
    if (resource.namespaced && edited.metadata?.namespace !== item.namespace) {
      message.error("metadata.namespace 必须与当前资源一致");
      return;
    }
    setYamlLoading(true);
    try {
      await api.updateResource(kind, item.namespace ?? "", item.name, edited, true);
      setYamlLoading(false);
      modal.confirm({
        title: "YAML 校验通过",
        content: "Dry Run 已成功。现在将修改提交到集群。",
        okText: "提交修改",
        cancelText: "继续编辑",
        onOk: async () => {
          setYamlLoading(true);
          try {
            await api.updateResource(kind, item.namespace ?? "", item.name, edited, false);
            message.success("资源已更新");
            setYamlEditorOpen(false);
            await objectQuery.refetch();
            await onChanged();
          } finally {
            setYamlLoading(false);
          }
        },
      });
    } catch (reason) {
      setYamlLoading(false);
      message.error(reason instanceof Error ? reason.message : "Dry Run 失败");
    }
  }

  const extra = item ? (
    <Space size={6}>
      {kind === "pods" ? (
        <Button size="small" icon={<TerminalSquare size={14} />} onClick={() => onLogs(item)}>
          日志
        </Button>
      ) : null}
      {scalable(kind) ? (
        <Button size="small" icon={<ArrowLeftRight size={14} />} onClick={() => onScale(item)}>
          扩缩容
        </Button>
      ) : null}
      {restartable(kind) ? (
        <Button size="small" icon={<RotateCw size={14} />} onClick={() => onRestart(item)}>
          重启
        </Button>
      ) : null}
      {editable(kind) ? (
        <Button size="small" icon={<Code2 size={14} />} onClick={() => setYamlEditorOpen(true)}>
          编辑
        </Button>
      ) : null}
      {deletable(kind) ? (
        <Button size="small" danger icon={<Trash2 size={14} />} onClick={() => onDelete(item)}>
          删除
        </Button>
      ) : null}
    </Space>
  ) : null;

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        width={760}
        title={
          item ? (
            <div className="drawer-title-line">
              <span className="resource-kind-icon">
                <KindIcon kind={item.kind} size={16} />
              </span>
              <span>{item.name}</span>
              <StatusBadge tone={item.statusTone}>{item.status}</StatusBadge>
            </div>
          ) : null
        }
        extra={extra}
      >
        {objectQuery.isLoading ? (
          <div className="drawer-loading">正在读取资源详情…</div>
        ) : objectQuery.isError ? (
          <Alert type="error" showIcon message={objectQuery.error instanceof Error ? objectQuery.error.message : "读取失败"} />
        ) : object ? (
          <Tabs
            items={[
              {
                key: "summary",
                label: "概览",
                children: <ObjectSummary object={object} item={item} />,
              },
              {
                key: "yaml",
                label: "YAML",
                children: (
                  <div className="yaml-tab">
                    <div className="code-toolbar">
                      <span>{object.apiVersion} / {object.kind}</span>
                      <Space size={6}>
                        <Button size="small" icon={<Copy size={14} />} onClick={copyYAML}>
                          复制
                        </Button>
                        {editable(kind) ? (
                          <Button size="small" icon={<Code2 size={14} />} onClick={() => setYamlEditorOpen(true)}>
                            编辑
                          </Button>
                        ) : null}
                      </Space>
                    </div>
                    <pre className="code-view">{yamlValue}</pre>
                  </div>
                ),
              },
              {
                key: "events",
                label: `事件 ${relatedEvents.length ? `(${relatedEvents.length})` : ""}`,
                children: (
                  <div className="detail-events">
                    {relatedEvents.length ? (
                      relatedEvents.map((event) => (
                        <div className="detail-event" key={event.id}>
                          <span className={`event-marker ${event.type === "Warning" ? "warning" : ""}`} />
                          <div>
                            <div className="detail-event-head">
                              <b>{event.reason}</b>
                              <time>{event.age}</time>
                            </div>
                            <p>{event.message}</p>
                          </div>
                          <Tag bordered={false}>{event.type}</Tag>
                        </div>
                      ))
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有关联事件" />
                    )}
                  </div>
                ),
              },
            ]}
          />
        ) : null}
      </Drawer>

      <Modal
        open={yamlEditorOpen}
        width={900}
        title={`编辑 ${item?.name ?? ""}`}
        onCancel={() => setYamlEditorOpen(false)}
        onOk={validateAndApply}
        okText="校验并应用"
        confirmLoading={yamlLoading}
        className="yaml-editor-modal"
      >
        <div className="yaml-editor-hint">
          <Play size={14} /> 提交前会自动执行 Kubernetes Dry Run。
        </div>
        <Input.TextArea
          className="yaml-editor"
          value={yamlText}
          onChange={(event) => setYamlText(event.target.value)}
          spellCheck={false}
          autoSize={{ minRows: 22, maxRows: 30 }}
        />
      </Modal>
    </>
  );
}

function ObjectSummary({ object, item }: { object: KubeObject; item: ResourceItem | null }) {
  const metadata = object.metadata ?? {};
  const labels = metadata.labels ?? {};
  const annotations = metadata.annotations ?? {};
  const containers =
    ((object.spec?.containers as Array<Record<string, unknown>> | undefined) ??
      (((object.spec?.template as Record<string, unknown> | undefined)?.spec as Record<string, unknown> | undefined)
        ?.containers as Array<Record<string, unknown>> | undefined) ??
      []);
  const conditions = (object.status?.conditions as Array<Record<string, unknown>> | undefined) ?? [];
  return (
    <div className="object-summary">
      <Descriptions
        bordered
        size="small"
        column={2}
        items={[
          { key: "kind", label: "类型", children: object.kind ?? item?.kind ?? "—" },
          { key: "namespace", label: "命名空间", children: metadata.namespace ?? "集群级" },
          { key: "created", label: "创建时间", children: metadata.creationTimestamp ?? "—" },
          { key: "resourceVersion", label: "Resource Version", children: metadata.resourceVersion ?? "—" },
        ]}
      />
      {containers.length ? (
        <section className="detail-section">
          <h3>容器</h3>
          <div className="container-list">
            {containers.map((container, index) => (
              <div className="container-row" key={String(container.name ?? index)}>
                <span className="container-icon">
                  <KindIcon kind="Pod" size={15} />
                </span>
                <div>
                  <b>{String(container.name ?? "container")}</b>
                  <span>{String(container.image ?? "未设置镜像")}</span>
                </div>
                <Tag bordered={false}>{containerReadyLabel(conditions, String(container.name ?? ""))}</Tag>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {conditions.length ? (
        <section className="detail-section">
          <h3>状态条件</h3>
          <div className="condition-grid">
            {conditions.map((condition, index) => (
              <div className="condition-row" key={`${String(condition.type ?? index)}`}>
                <StatusBadge tone={String(condition.status) === "True" ? "success" : "warning"}>
                  {String(condition.type ?? "Condition")}
                </StatusBadge>
                <span>{String(condition.message ?? condition.reason ?? "—")}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <section className="detail-section">
        <h3>标签</h3>
        <div className="tag-cloud">
          {Object.entries(labels).map(([key, value]) => (
            <Tag key={key} bordered={false}>
              {key}: {value}
            </Tag>
          ))}
          {!Object.keys(labels).length ? <span className="muted">没有标签</span> : null}
        </div>
      </section>
      {Object.keys(annotations).length ? (
        <section className="detail-section">
          <h3>注解</h3>
          <div className="annotation-list">
            {Object.entries(annotations).slice(0, 20).map(([key, value]) => (
              <div key={key}>
                <b>{key}</b>
                <span>{value}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function containerReadyLabel(conditions: Array<Record<string, unknown>>, containerName: string) {
  const condition = conditions.find((item) => String(item.type) === "Ready");
  if (condition && String(condition.status) === "True") return "Ready";
  return containerName ? "已声明" : "—";
}

function scalable(kind: string) {
  return ["deployments", "statefulsets", "replicasets"].includes(kind);
}

function restartable(kind: string) {
  return ["deployments", "statefulsets", "daemonsets"].includes(kind);
}

function editable(kind: string) {
  return [
    "deployments",
    "statefulsets",
    "daemonsets",
    "replicasets",
    "jobs",
    "cronjobs",
    "services",
    "ingresses",
    "networkpolicies",
    "configmaps",
    "persistentvolumeclaims",
  ].includes(kind);
}

function deletable(kind: string) {
  return [
    "deployments",
    "statefulsets",
    "daemonsets",
    "replicasets",
    "jobs",
    "cronjobs",
    "pods",
    "services",
    "ingresses",
    "networkpolicies",
    "configmaps",
    "secrets",
    "persistentvolumeclaims",
  ].includes(kind);
}
