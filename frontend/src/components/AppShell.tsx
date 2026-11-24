import {
  Activity,
  Boxes,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Command,
  Container,
  Database,
  FolderTree,
  Globe2,
  HardDrive,
  Layers3,
  LogOut,
  Moon,
  Network,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sun,
  Workflow,
} from "lucide-react";
import {
  Button,
  Dropdown,
  Input,
  Modal,
  Select,
  Tooltip,
  message,
  type MenuProps,
} from "antd";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useShell } from "../context";

const navGroups = [
  {
    label: "集群",
    items: [
      { path: "/", label: "总览", icon: Activity },
      { path: "/events", label: "事件", icon: CalendarClock },
    ],
  },
  {
    label: "工作负载",
    items: [
      { key: "deployments", label: "Deployments", icon: Layers3 },
      { key: "pods", label: "Pods", icon: Container },
      { key: "statefulsets", label: "StatefulSets", icon: Database },
      { key: "daemonsets", label: "DaemonSets", icon: Workflow },
      { key: "jobs", label: "Jobs", icon: CalendarClock },
      { key: "cronjobs", label: "CronJobs", icon: CalendarClock },
    ],
  },
  {
    label: "网络",
    items: [
      { key: "services", label: "Services", icon: Network },
      { key: "ingresses", label: "Ingresses", icon: Globe2 },
      { key: "networkpolicies", label: "NetworkPolicies", icon: ShieldCheck },
    ],
  },
  {
    label: "配置",
    items: [
      { key: "configmaps", label: "ConfigMaps", icon: Settings2 },
      { key: "secrets", label: "Secrets", icon: ShieldCheck },
    ],
  },
  {
    label: "存储",
    items: [
      { key: "persistentvolumeclaims", label: "PVCs", icon: HardDrive },
      { key: "persistentvolumes", label: "PVs", icon: HardDrive },
      { key: "storageclasses", label: "StorageClasses", icon: HardDrive },
    ],
  },
  {
    label: "节点",
    items: [
      { key: "nodes", label: "Nodes", icon: Server },
      { key: "namespaces", label: "Namespaces", icon: FolderTree },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { namespace, setNamespace, bootstrap, dark, setDark } = useShell();
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 1180);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteSearch, setPaletteSearch] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    function onResize() {
      if (window.innerWidth < 1040) setCollapsed(true);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    function onKeydown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, []);

  const currentResource = bootstrap.catalog.find(
    (resource) => location.pathname === `/resources/${resource.key}`,
  );
  const title =
    location.pathname === "/"
      ? "集群总览"
      : location.pathname === "/events"
        ? "事件中心"
        : currentResource?.label ?? "KubeDeck";

  const paletteItems = useMemo(() => {
    const term = paletteSearch.trim().toLowerCase();
    return navGroups
      .flatMap((group) =>
        group.items.map((item) => ({
          ...item,
          group: group.label,
          path: "path" in item ? item.path : `/resources/${item.key}`,
        })),
      )
      .filter((item) => `${item.label} ${item.group}`.toLowerCase().includes(term));
  }, [paletteSearch]);

  async function logout() {
    await api.logout();
    window.location.reload();
  }

  const userMenu: MenuProps = {
    items: [
      {
        key: "theme",
        icon: dark ? <Sun size={15} /> : <Moon size={15} />,
        label: dark ? "切换浅色模式" : "切换深色模式",
        onClick: () => setDark(!dark),
      },
      { type: "divider" },
      {
        key: "logout",
        icon: <LogOut size={15} />,
        label: "退出登录",
        danger: true,
        onClick: logout,
      },
    ],
  };

  return (
    <div className={`app-frame ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark">
            <Boxes size={20} />
          </span>
          {!collapsed ? (
            <div className="brand-copy">
              <b>KubeDeck</b>
              <span>Control plane</span>
            </div>
          ) : null}
        </div>
        <nav className="sidebar-nav">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              {!collapsed ? <div className="nav-group-label">{group.label}</div> : null}
              {group.items.map((item) => {
                const path = "path" in item ? item.path : `/resources/${item.key}`;
                const Icon = item.icon;
                const link = (
                  <NavLink
                    key={path}
                    to={path}
                    end={path === "/"}
                    className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                  >
                    <Icon size={17} strokeWidth={1.8} />
                    {!collapsed ? <span>{item.label}</span> : null}
                  </NavLink>
                );
                return collapsed ? (
                  <Tooltip title={item.label} placement="right" key={path}>
                    {link}
                  </Tooltip>
                ) : (
                  link
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="sidebar-help" onClick={() => setPaletteOpen(true)}>
            <CircleHelp size={17} />
            {!collapsed ? <span>快速导航</span> : null}
            {!collapsed ? <kbd>⌘K</kbd> : null}
          </button>
          <button
            className="sidebar-collapse"
            onClick={() => setCollapsed((value) => !value)}
            title={collapsed ? "展开导航" : "收起导航"}
          >
            {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
            {!collapsed ? <span>收起导航</span> : null}
          </button>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="topbar-title">
            <span className="breadcrumb-root">{bootstrap.clusterName}</span>
            <span className="breadcrumb-separator">/</span>
            <b>{title}</b>
          </div>
          <div className="topbar-actions">
            <div className="namespace-control">
              <span>Namespace</span>
              <Select
                value={namespace || "_all"}
                onChange={(value) => setNamespace(value === "_all" ? "" : value)}
                options={[
                  { value: "_all", label: "全部命名空间" },
                  ...bootstrap.namespaces.map((value) => ({ value, label: value })),
                ]}
                popupMatchSelectWidth={240}
                style={{ width: 174 }}
              />
            </div>
            <button className="command-button" onClick={() => setPaletteOpen(true)}>
              <Search size={15} />
              <span>快速导航</span>
              <kbd>⌘ K</kbd>
            </button>
            <Tooltip title="刷新当前数据">
              <Button
                type="text"
                icon={<RefreshCw size={17} />}
                onClick={() => {
                  queryClient.invalidateQueries();
                  message.success("数据已刷新");
                }}
              />
            </Tooltip>
            <Dropdown menu={userMenu} trigger={["click"]} placement="bottomRight">
              <button className="user-button">
                <span className="avatar">KD</span>
                <span className="user-copy">
                  <b>Cluster Admin</b>
                  <small>已连接</small>
                </span>
              </button>
            </Dropdown>
          </div>
        </header>
        <main className="page-content">{children}</main>
      </div>

      <Modal
        open={paletteOpen}
        onCancel={() => setPaletteOpen(false)}
        footer={null}
        width={620}
        className="command-modal"
        title={
          <div className="command-modal-title">
            <Command size={17} />
            <span>快速导航</span>
          </div>
        }
      >
        <Input
          autoFocus
          allowClear
          prefix={<Search size={16} />}
          placeholder="搜索页面或资源类型"
          value={paletteSearch}
          onChange={(event) => setPaletteSearch(event.target.value)}
        />
        <div className="command-results">
          {paletteItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                onClick={() => {
                  navigate(item.path);
                  setPaletteOpen(false);
                  setPaletteSearch("");
                }}
              >
                <span className="command-result-icon">
                  <Icon size={17} />
                </span>
                <span>
                  <b>{item.label}</b>
                  <small>{item.group}</small>
                </span>
                <ChevronRight size={15} />
              </button>
            );
          })}
          {!paletteItems.length ? <div className="command-empty">没有匹配的页面</div> : null}
        </div>
      </Modal>
    </div>
  );
}
