import { Alert, Button, Spin } from "antd";
import { Boxes, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";
import { api } from "./api";
import { ShellContext } from "./context";
import { AppShell } from "./components/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { OverviewPage } from "./pages/OverviewPage";
import { ResourcePage } from "./pages/ResourcePage";
import { EventsPage } from "./pages/EventsPage";

export default function App({
  dark,
  setDark,
}: {
  dark: boolean;
  setDark: (value: boolean) => void;
}) {
  const authQuery = useQuery({
    queryKey: ["auth-status"],
    queryFn: api.authStatus,
    retry: false,
  });

  if (authQuery.isLoading) {
    return (
      <div className="boot-screen">
        <span className="brand-mark">
          <Boxes size={22} />
        </span>
        <Spin size="small" />
        <span>正在连接集群…</span>
      </div>
    );
  }
  if (authQuery.isError) {
    return (
      <div className="boot-screen boot-error">
        <Alert
          type="error"
          showIcon
          message="无法连接 Dashboard 服务"
          description={authQuery.error instanceof Error ? authQuery.error.message : "请检查后端服务状态"}
        />
        <Button icon={<RefreshCw size={15} />} onClick={() => authQuery.refetch()}>
          重试
        </Button>
      </div>
    );
  }
  if (!authQuery.data?.authenticated) {
    return (
      <LoginPage
        clusterName={authQuery.data?.clusterName ?? "Kubernetes"}
        onAuthenticated={() => authQuery.refetch()}
      />
    );
  }
  return <AuthenticatedApp dark={dark} setDark={setDark} />;
}

function AuthenticatedApp({
  dark,
  setDark,
}: {
  dark: boolean;
  setDark: (value: boolean) => void;
}) {
  const [namespace, setNamespaceState] = useState(() => localStorage.getItem("kubedeck-namespace") ?? "");
  const bootstrapQuery = useQuery({
    queryKey: ["bootstrap"],
    queryFn: api.bootstrap,
  });

  function setNamespace(value: string) {
    setNamespaceState(value);
    localStorage.setItem("kubedeck-namespace", value);
  }

  if (bootstrapQuery.isLoading) {
    return (
      <div className="boot-screen">
        <Spin />
        <span>正在读取命名空间与资源目录…</span>
      </div>
    );
  }

  if (bootstrapQuery.isError || !bootstrapQuery.data) {
    return (
      <div className="boot-screen boot-error">
        <Alert
          type="error"
          showIcon
          message="集群初始化失败"
          description={bootstrapQuery.error instanceof Error ? bootstrapQuery.error.message : "无法读取集群资源"}
        />
        <Button icon={<RefreshCw size={15} />} onClick={() => bootstrapQuery.refetch()}>
          重新连接
        </Button>
      </div>
    );
  }

  return (
    <ShellContext.Provider
      value={{
        namespace,
        setNamespace,
        bootstrap: bootstrapQuery.data,
        dark,
        setDark,
      }}
    >
      <AppShell>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/resources/:kind" element={<ResourcePage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </ShellContext.Provider>
  );
}
