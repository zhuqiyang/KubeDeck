import {
  Boxes,
  CalendarClock,
  Container,
  Database,
  FolderTree,
  Globe2,
  HardDrive,
  Layers3,
  LockKeyhole,
  Network,
  Server,
  Settings2,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import type { ResourceItem } from "../types";

export function StatusBadge({
  tone,
  children,
}: {
  tone: ResourceItem["statusTone"];
  children: React.ReactNode;
}) {
  return (
    <span className={`status-pill status-${tone}`}>
      <span className="status-dot" />
      {children}
    </span>
  );
}

export function KindIcon({ kind, size = 16 }: { kind: string; size?: number }) {
  const props = { size, strokeWidth: 1.8 };
  const common: Record<string, React.ReactElement> = {
    Pod: <Container {...props} />,
    Deployment: <Layers3 {...props} />,
    StatefulSet: <Database {...props} />,
    DaemonSet: <Workflow {...props} />,
    ReplicaSet: <Boxes {...props} />,
    Job: <CalendarClock {...props} />,
    CronJob: <CalendarClock {...props} />,
    Service: <Network {...props} />,
    Ingress: <Globe2 {...props} />,
    NetworkPolicy: <ShieldCheck {...props} />,
    EndpointSlice: <Network {...props} />,
    ConfigMap: <Settings2 {...props} />,
    Secret: <LockKeyhole {...props} />,
    PersistentVolumeClaim: <HardDrive {...props} />,
    PersistentVolume: <HardDrive {...props} />,
    StorageClass: <HardDrive {...props} />,
    Node: <Server {...props} />,
    Namespace: <FolderTree {...props} />,
  };
  return common[kind] ?? <Boxes {...props} />;
}
