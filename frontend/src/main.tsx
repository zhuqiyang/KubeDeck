import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp, ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 8_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Root() {
  const [dark, setDark] = React.useState(() => localStorage.getItem("kubedeck-theme") === "dark");

  React.useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("kubedeck-theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: "#2563eb",
          colorSuccess: "#15803d",
          colorWarning: "#b45309",
          colorError: "#c73737",
          colorInfo: "#2563eb",
          borderRadius: 6,
          controlHeight: 34,
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        },
        components: {
          Table: {
            headerBg: dark ? "#1d2733" : "#f7f8fa",
            headerColor: dark ? "#9baaba" : "#657184",
            rowHoverBg: dark ? "#202c39" : "#f7f9fc",
            borderColor: dark ? "#2b3745" : "#e8ebef",
            cellPaddingBlock: 11,
            cellPaddingInline: 14,
          },
          Menu: {
            itemHeight: 38,
          },
        },
      }}
    >
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App dark={dark} setDark={setDark} />
          </BrowserRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
