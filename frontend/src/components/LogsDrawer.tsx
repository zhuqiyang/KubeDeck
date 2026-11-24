import { Download, Pause, Play, RotateCw, TerminalSquare, Trash2 } from "lucide-react";
import { Button, Drawer, Empty, Select, Space, Switch, Tag, message } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, createLogStream } from "../api";
import type { KubeObject, ResourceItem } from "../types";

interface LogsDrawerProps {
  open: boolean;
  pod: ResourceItem | null;
  onClose: () => void;
}

export function LogsDrawer({ open, pod, onClose }: LogsDrawerProps) {
  const [container, setContainer] = useState("");
  const [tailLines, setTailLines] = useState(300);
  const [follow, setFollow] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [runToken, setRunToken] = useState(0);
  const [lines, setLines] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [streamError, setStreamError] = useState("");
  const terminalRef = useRef<HTMLDivElement>(null);

  const podQuery = useQuery({
    queryKey: ["pod-detail", pod?.namespace, pod?.name],
    queryFn: () => api.resource("pods", pod?.namespace ?? "", pod?.name ?? ""),
    enabled: open && Boolean(pod?.name),
  });

  const containers = useMemo(() => {
    const object = podQuery.data as KubeObject | undefined;
    const specs = (object?.spec?.containers as Array<{ name?: string }> | undefined) ?? [];
    return specs.map((item) => item.name).filter((value): value is string => Boolean(value));
  }, [podQuery.data]);

  useEffect(() => {
    if (!open) {
      setStreaming(false);
      setLines([]);
      return;
    }
    setLines([]);
    setStreamError("");
    setContainer(containers[0] ?? "");
    setStreaming(containers.length > 0);
    setRunToken((value) => value + 1);
  }, [open, pod?.name, containers[0]]);

  useEffect(() => {
    if (!open || !streaming || !pod?.namespace || !pod.name || !container) return;
    setLines([]);
    setStreamError("");
    const stream = createLogStream({
      namespace: pod.namespace,
      pod: pod.name,
      container,
      tailLines,
      follow,
      onLine: (line) => setLines((current) => [...current, line]),
      onError: (value) => {
        setStreamError(value);
        setStreaming(false);
      },
      onEnd: () => setStreaming(false),
    });
    return () => stream.close();
  }, [open, streaming, runToken, pod?.namespace, pod?.name, container, tailLines, follow]);

  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  function restartStream() {
    setLines([]);
    setStreamError("");
    setStreaming(true);
    setRunToken((value) => value + 1);
  }

  function downloadLogs() {
    if (!lines.length) return;
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${pod?.namespace}-${pod?.name}-${container}.log`;
    anchor.click();
    URL.revokeObjectURL(url);
    message.success("日志已下载");
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={960}
      className="logs-drawer"
      title={
        <div className="drawer-title-line">
          <TerminalSquare size={18} />
          <span>容器日志</span>
          {pod ? (
            <Tag bordered={false}>
              {pod.namespace}/{pod.name}
            </Tag>
          ) : null}
        </div>
      }
      extra={
        <Space size={8}>
          <Button icon={<Download size={15} />} onClick={downloadLogs} disabled={!lines.length}>
            下载
          </Button>
          <Button
            icon={streaming ? <Pause size={15} /> : <Play size={15} />}
            onClick={() => {
              if (streaming) setStreaming(false);
              else restartStream();
            }}
          >
            {streaming ? "暂停" : "继续"}
          </Button>
          <Button icon={<RotateCw size={15} />} onClick={restartStream}>
            刷新
          </Button>
        </Space>
      }
    >
      <div className="log-toolbar">
        <label>
          容器
          <Select
            value={container || undefined}
            placeholder="选择容器"
            options={containers.map((value) => ({ value, label: value }))}
            onChange={setContainer}
            style={{ width: 190 }}
          />
        </label>
        <label>
          行数
          <Select
            value={tailLines}
            onChange={setTailLines}
            options={[100, 300, 500, 1000, 2000].map((value) => ({
              value,
              label: String(value),
            }))}
            style={{ width: 100 }}
          />
        </label>
        <label className="inline-switch">
          <Switch size="small" checked={follow} onChange={setFollow} />
          持续跟随
        </label>
        <label className="inline-switch">
          <Switch size="small" checked={autoScroll} onChange={setAutoScroll} />
          自动滚动
        </label>
        {lines.length ? <span className="log-count">{lines.length.toLocaleString()} 行</span> : null}
      </div>
      {streamError ? <div className="inline-error">{streamError}</div> : null}
      {podQuery.isLoading ? (
        <div className="log-empty">正在读取 Pod 配置…</div>
      ) : !containers.length ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该 Pod 没有可读取日志的容器" />
      ) : (
        <div className="terminal-shell">
          <div className="terminal-chrome">
            <span />
            <span />
            <span />
            <b>{container || "container"}</b>
            <button type="button" onClick={() => setLines([])} title="清空显示">
              <Trash2 size={14} />
            </button>
          </div>
          <div className="terminal-output" ref={terminalRef}>
            {lines.length ? (
              lines.map((line, index) => (
                <div className="log-line" key={`${index}-${line.slice(0, 24)}`}>
                  <span className="log-number">{index + 1}</span>
                  <span>{line}</span>
                </div>
              ))
            ) : (
              <span className="terminal-placeholder">
                {streaming ? "等待日志输出…" : "暂无日志。点击“继续”重新读取。"}
              </span>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
