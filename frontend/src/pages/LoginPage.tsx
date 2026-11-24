import { Alert, Button, Form, Input } from "antd";
import { ArrowRight, Boxes, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "../api";

export function LoginPage({
  clusterName,
  onAuthenticated,
}: {
  clusterName: string;
  onAuthenticated: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(values: { password: string }) {
    setLoading(true);
    setError("");
    try {
      await api.login(values.password);
      onAuthenticated();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "登录失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-identity">
        <div className="brand-lockup brand-lockup-large">
          <span className="brand-mark">
            <Boxes size={24} />
          </span>
          <span>KubeDeck</span>
        </div>
        <div className="login-context">
          <span className="eyebrow">KUBERNETES OPERATIONS</span>
          <h1>集群运行状态，一处掌握。</h1>
          <p>工作负载、事件、日志与资源操作统一入口。</p>
          <div className="cluster-stamp">
            <span className="cluster-live-dot" />
            <span>{clusterName}</span>
            <span className="cluster-stamp-meta">Internal cluster</span>
          </div>
        </div>
      </div>
      <div className="login-panel-wrap">
        <div className="login-panel">
          <div className="login-panel-icon">
            <LockKeyhole size={20} />
          </div>
          <h2>访问控制台</h2>
          <p className="muted">输入当前集群的 Dashboard 访问密码。</p>
          {error ? <Alert type="error" showIcon message={error} /> : null}
          <Form layout="vertical" onFinish={submit} requiredMark={false}>
            <Form.Item
              label="访问密码"
              name="password"
              rules={[{ required: true, message: "请输入访问密码" }]}
            >
              <Input.Password size="large" autoFocus placeholder="输入密码" />
            </Form.Item>
            <Button
              type="primary"
              size="large"
              htmlType="submit"
              loading={loading}
              block
              icon={<ArrowRight size={17} />}
              iconPosition="end"
            >
              进入集群
            </Button>
          </Form>
          <div className="login-footnote">会话仅保存在 HttpOnly Cookie 中，有效期 12 小时。</div>
        </div>
      </div>
    </div>
  );
}
