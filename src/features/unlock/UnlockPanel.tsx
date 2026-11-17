import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Clock3,
  Globe2,
  Info,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { useUnlockSnapshot } from "./useUnlockSnapshot";
import { resultStatus, serviceKey, serviceStatus } from "./model";
import type { IpFamily, UnlockResult, UnlockService } from "./types";
import iconMap from "./iconMap.json";
import "./unlock.css";

const ICONS: Record<string, string> = iconMap;
const FAMILIES: { id: IpFamily; label: string }[] = [
  { id: "combined", label: "综合" },
  { id: "ipv4", label: "IPv4" },
  { id: "ipv6", label: "IPv6" },
];

function ServiceIcon({ service }: { service: UnlockService }) {
  const filename =
    ICONS[service.name.trim().toLowerCase().replace(/\s+/g, " ")];
  return (
    <span className="unlock-brand" aria-hidden="true">
      {filename ? (
        <img
          src={`${import.meta.env.BASE_URL}unlock-icons/${filename}`}
          alt=""
        />
      ) : (
        <span>{(service.displayName || service.name).slice(0, 2)}</span>
      )}
    </span>
  );
}

function FamilyIndicator({
  label,
  result,
}: {
  label: string;
  result: UnlockResult | null;
}) {
  const status = resultStatus(result);
  return (
    <span
      className={`unlock-family-indicator is-${status.tone}`}
      title={`${label} · ${status.label}`}
    >
      <i />
      {label}
    </span>
  );
}

function ServiceDetails({
  service,
  onClose,
}: {
  service: UnlockService;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);
  const stacks = [
    { label: "IPv4", result: service.ipv4 },
    { label: "IPv6", result: service.ipv6 },
    ...(service.auto ? [{ label: "自动检测", result: service.auto }] : []),
  ];
  return (
    <dialog
      ref={dialog}
      className="unlock-dialog"
      aria-labelledby="unlock-detail-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialog.current?.close();
      }}
    >
      <div className="unlock-dialog-content">
        <div className="unlock-dialog-heading">
          <ServiceIcon service={service} />
          <div>
            <h3 id="unlock-detail-title">
              {service.displayName || service.name}
            </h3>
            <p>{service.name}</p>
          </div>
          <button
            type="button"
            className="unlock-icon-button"
            aria-label="关闭服务详情"
            onClick={() => dialog.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        {stacks.map(({ label, result }) => {
          const status = resultStatus(result);
          return (
            <div className="unlock-detail-stack" key={label}>
              <div>
                <strong>{label}</strong>
                <span className={`unlock-status is-${status.tone}`}>
                  {status.label}
                </span>
              </div>
              {status.region && (
                <p>
                  解锁区域 <strong>{status.region}</strong>
                </p>
              )}
              <p className="unlock-detail-note">
                {result?.info || result?.raw || "暂无此网络协议的检测结果"}
              </p>
            </div>
          );
        })}
      </div>
    </dialog>
  );
}

export default function UnlockPanel({ uuid }: { uuid: string }) {
  const { snapshot, loading, testing, canProbe, error, refresh } =
    useUnlockSnapshot(uuid);
  const [category, setCategory] = useState("all");
  const [family, setFamily] = useState<IpFamily>("combined");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const node = snapshot?.nodes[uuid];
  const services = Array.isArray(node?.services) ? node.services : [];
  const running = testing;
  const waiting = snapshot?.autoProbe !== false && !services.length && Boolean(snapshot?.activeTask) && !running;
  const regionIds = Array.from(
    new Set(services.map((service) => service.regionId)),
  );
  const categories = regionIds.map((id) => ({
    id,
    label:
      id === "0"
        ? "流媒体与网络"
        : id === "11"
          ? "AI 平台"
          : snapshot?.regionsCatalog?.find((region) => region.id === id)
              ?.nameZh || "地区平台",
  }));
  const keyword = query.trim().toLowerCase();
  const filtered = services.filter(
    (service) =>
      (category === "all" || service.regionId === category) &&
      `${service.name} ${service.displayName ?? ""}`
        .toLowerCase()
        .includes(keyword),
  );
  const statuses = filtered.map((service) => serviceStatus(service, family));
  const counts = {
    unlocked: statuses.filter((status) => status.tone === "success").length,
    restricted: statuses.filter((status) => status.tone === "restricted")
      .length,
    blocked: statuses.filter((status) => status.tone === "blocked").length,
    unknown: statuses.filter((status) => status.tone === "unknown").length,
  };
  const selectedService = services.find(
    (service) => serviceKey(service) === selectedKey,
  );
  const date = node?.updatedAt ? new Date(node.updatedAt) : null;
  const updatedAt =
    date && Number.isFinite(date.getTime())
      ? date.toLocaleString("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : null;

  return (
    <Card
      id="unlock"
      className="unlock-panel"
      aria-labelledby="unlock-heading"
      aria-busy={loading}
    >
      <div className="unlock-heading">
        <span className="unlock-heading-icon">
          <ShieldCheck size={23} />
        </span>
        <div className="unlock-heading-text">
          <div className="unlock-title-line">
            <h2 id="unlock-heading">流媒体与 AI 解锁</h2>
            <span className="unlock-plugin-badge">UnlockTest</span>
          </div>
          <p>平台访问能力与解锁区域</p>
        </div>
        <button
          type="button"
          className="unlock-refresh"
          onClick={refresh}
          disabled={loading || testing || waiting}
        >
          <RefreshCw
            size={15}
            className={loading || testing ? "unlock-spinning" : ""}
          />
          {testing ? "检测中" : canProbe ? "重新检测" : "刷新结果"}
        </button>
      </div>

      {snapshot?.preview && (
        <div className="unlock-preview-notice">
          <Info size={15} />
          本地预览 · 以下解锁状态为演示数据
        </div>
      )}
      {waiting && (
        <div className="unlock-info" role="status">
          <Clock3 size={15} />
          等待其他节点完成检测后，自动开始首次检测
        </div>
      )}
      {running && (
        <div className="unlock-info" role="status">
          <RefreshCw size={15} className="unlock-spinning" />
          {services.length
            ? "正在重新检测，当前展示上次保存的结果"
            : "正在进行首次检测，完成后会保存结果"}
        </div>
      )}
      {(node?.error || error) && services.length > 0 && (
        <div className="unlock-info" role="status">
          <Info size={15} />
          最近一次检测失败，当前展示上次保存的结果
        </div>
      )}

      {loading ? (
        <div className="unlock-loading" role="status">
          <div className="unlock-skeleton-grid">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} />
            ))}
          </div>
          <span>正在读取解锁结果…</span>
        </div>
      ) : error && services.length === 0 ? (
        <div className="unlock-empty" role="alert">
          <Info size={27} />
          <h3>暂时没有可用结果</h3>
          <p>{error}</p>
        </div>
      ) : services.length === 0 ? (
        <div className="unlock-empty">
          <Globe2 size={29} />
          <h3>{node?.error ? "本次解锁检测未完成" : node?.workerInstalled === false ? "等待安装检测组件" : snapshot?.manualExecutionRequired ? "等待手动检测" : "等待首次解锁检测"}</h3>
          <p>
            {node?.error
              ? "请确认机器上的检测组件在线，以管理员身份登录后点击“重新检测”。"
              : node?.workerInstalled === false
                ? "在这台机器运行安装命令后，首次检测结果会自动显示；之后可由管理员在这里手动复检。"
              : snapshot?.manualExecutionRequired
                ? "流媒体检测界面已就绪，手动完成节点检测并保存结果后，点击“刷新结果”即可查看。"
                : "该节点完成 UnlockTest 检测后，解锁结果会显示在这里。"}
          </p>
        </div>
      ) : (
        <>
          <div className="unlock-overview">
            <div className="unlock-count">
              <span className="unlock-count-icon">
                <Check size={18} />
              </span>
              <strong>
                {counts.unlocked}
                <small> / {filtered.length}</small>
              </strong>
              <span>已解锁</span>
            </div>
            <div className="unlock-count-details">
              <span>
                <i className="is-restricted" />
                受限 <b>{counts.restricted}</b>
              </span>
              <span>
                <i className="is-blocked" />
                未解锁 <b>{counts.blocked}</b>
              </span>
              <span>
                <i className="is-unknown" />
                待确认 <b>{counts.unknown}</b>
              </span>
            </div>
            <span className="unlock-updated">
              <Clock3 size={14} />
              {updatedAt ? `最近检测 ${updatedAt}` : "暂无检测时间"}
            </span>
          </div>

          <div className="unlock-toolbar">
            <div
              className="unlock-categories"
              role="group"
              aria-label="平台分类"
            >
              <button
                type="button"
                aria-pressed={category === "all"}
                onClick={() => setCategory("all")}
              >
                全部平台
              </button>
              {categories.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  aria-pressed={category === item.id}
                  onClick={() => setCategory(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="unlock-families" role="group" aria-label="网络协议">
              {FAMILIES.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  aria-pressed={family === item.id}
                  onClick={() => setFamily(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <label className="unlock-search">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索平台"
                aria-label="搜索解锁平台"
              />
            </label>
          </div>

          <div className="unlock-service-grid">
            {filtered.map((service) => {
              const status = serviceStatus(service, family);
              return (
                <button
                  type="button"
                  className={`unlock-service is-${status.tone}`}
                  key={serviceKey(service)}
                  onClick={() => setSelectedKey(serviceKey(service))}
                  aria-label={`查看 ${service.displayName || service.name} 解锁详情，${status.label}`}
                >
                  <div className="unlock-service-heading">
                    <ServiceIcon service={service} />
                    <ChevronRight size={15} className="unlock-service-arrow" />
                  </div>
                  <h3>{service.displayName || service.name}</h3>
                  <div className="unlock-service-protocols">
                    <FamilyIndicator label="IPv4" result={service.ipv4} />
                    <FamilyIndicator label="IPv6" result={service.ipv6} />
                  </div>
                  <div className="unlock-service-status">
                    <span className={`unlock-status is-${status.tone}`}>
                      {status.tone === "success" ? (
                        <Check size={13} />
                      ) : status.tone === "blocked" ? (
                        <LockKeyhole size={12} />
                      ) : (
                        <Info size={13} />
                      )}
                      {status.label}
                    </span>
                    {status.region && (
                      <span
                        className="unlock-region"
                        title={`解锁区域 ${status.region}`}
                      >
                        {status.region}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          {filtered.length === 0 && (
            <div className="unlock-no-match" role="status">
              没有匹配的平台，请调整搜索或分类。
            </div>
          )}
          <div className="unlock-footer">
            <span>首次成功后保存结果 · 点击“重新检测”时更新</span>
            <a
              href="https://github.com/livingfree2023/Komari-Plugin-UnlockTest"
              target="_blank"
              rel="noreferrer"
            >
              由 UnlockTest 提供 <ChevronRight size={12} />
            </a>
          </div>
        </>
      )}
      {selectedService && (
        <ServiceDetails
          service={selectedService}
          onClose={() => setSelectedKey(null)}
        />
      )}
    </Card>
  );
}
