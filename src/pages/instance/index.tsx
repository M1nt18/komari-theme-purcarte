import { useState, useEffect, lazy, Suspense, useMemo, memo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useNodeData } from "@/contexts/NodeDataContext";
import { useLiveData } from "@/contexts/LiveDataContext";
import type { NodeData } from "@/types/node";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Instance from "./Instance";
const LoadCharts = lazy(() => import("./LoadCharts"));
const PingChart = lazy(() => import("./PingChart")
  .then(module => ({ default: memo(module.default) })));
import Loading from "@/components/loading";
import Flag from "@/components/sections/Flag";
import { useAppConfig } from "@/config";
import { useIsMobile } from "@/hooks/useMobile";
import { useLocale } from "@/config/hooks";
import { Card } from "@/components/ui/card";
import { NodeBillingSettings } from "@/features/traffic-budget/NodeBillingSettings";
const UnlockPanel = lazy(() => import("@/features/unlock/UnlockPanel")
  .then(module => ({ default: memo(module.default) })));
const TrafficForecastPanel = lazy(() => import("@/features/netforecast/TrafficForecastPanel")
  .then(module => ({ default: memo(module.default) })));

const InstancePage = () => {
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();
  const { nodes: staticNodes, loading: nodesLoading } = useNodeData();
  const { liveData } = useLiveData();
  const staticNode = useMemo(() => staticNodes.find((node: NodeData) => node.uuid === uuid) ?? null,
    [staticNodes, uuid]);
  const [chartType, setChartType] = useState<"forecast" | "unlock" | "load" | "ping">(
    () => window.location.hash === "#unlock" ? "unlock" : "forecast"
  );
  const [loadHours, setLoadHours] = useState<number>(0);
  const [pingHours, setPingHours] = useState<number>(1); // 默认1小时
  const [billingNode, setBillingNode] = useState<string | null>(null);
  const { enableInstanceDetail, enablePingChart, enableTrafficForecast, enableUnlockTest, publicSettings, siteStatus } =
    useAppConfig();
  const isMobile = useIsMobile();
  const { t } = useLocale();

  const maxRecordPreserveTime = publicSettings?.record_preserve_time || 0; // 默认0表示关闭
  const maxPingRecordPreserveTime =
    publicSettings?.ping_record_preserve_time || 24; // 默认1天

  const timeRanges = useMemo(() => {
    return [
      { label: t("instancePage.live"), hours: 0 },
      { label: t("instancePage.hours", { count: 1 }), hours: 1 },
      { label: t("instancePage.hours", { count: 4 }), hours: 4 },
      { label: t("instancePage.days", { count: 1 }), hours: 24 },
      { label: t("instancePage.days", { count: 7 }), hours: 168 },
      { label: t("instancePage.days", { count: 30 }), hours: 720 },
    ];
  }, [t]);

  const pingTimeRanges = useMemo(() => {
    const filtered = timeRanges.filter(
      (range) => range.hours !== 0 && range.hours <= maxPingRecordPreserveTime
    );

    if (maxPingRecordPreserveTime > 720) {
      const dynamicLabel =
        maxPingRecordPreserveTime % 24 === 0
          ? t("instancePage.days", {
              count: Math.floor(maxPingRecordPreserveTime / 24),
            })
          : t("instancePage.hours", { count: maxPingRecordPreserveTime });
      filtered.push({
        label: dynamicLabel,
        hours: maxPingRecordPreserveTime,
      });
    }

    return filtered;
  }, [timeRanges, maxPingRecordPreserveTime, t]);

  const loadTimeRanges = useMemo(() => {
    const filtered = timeRanges.filter(
      (range) => range.hours <= maxRecordPreserveTime
    );
    if (maxRecordPreserveTime > 720) {
      const dynamicLabel =
        maxRecordPreserveTime % 24 === 0
          ? t("instancePage.days", {
              count: Math.floor(maxRecordPreserveTime / 24),
            })
          : t("instancePage.hours", { count: maxRecordPreserveTime });
      filtered.push({
        label: dynamicLabel,
        hours: maxRecordPreserveTime,
      });
    }

    return filtered;
  }, [timeRanges, maxRecordPreserveTime, t]);

  useEffect(() => {
    const tab = window.location.hash === "#unlock" && enableUnlockTest ? "unlock" : enableTrafficForecast ? "forecast" : enableUnlockTest ? 'unlock' : 'load';
    setChartType(tab);
  }, [uuid,enableTrafficForecast,enableUnlockTest]);

  useEffect(()=>{if(chartType==='ping'&&!enablePingChart)setChartType('load');},[chartType,enablePingChart]);

  const stats = useMemo(() => {
    if (!staticNode || !liveData) return undefined;
    return liveData[staticNode.uuid];
  }, [staticNode, liveData]);

  const node = staticNode;
  const canManageBilling = siteStatus === "authenticated" || siteStatus === "private-authenticated";
  const billingOpen = canManageBilling && billingNode === uuid;
  const isOnline = stats?.online ?? false;

  useEffect(() => {
    if (!node || nodesLoading || window.location.hash !== "#unlock") return;
    const frame = requestAnimationFrame(() => {
      document.getElementById("instance-chart-controls")?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [node, nodesLoading, uuid]);

  const handleChartTypeChange = (nextType: "forecast" | "unlock" | "load" | "ping") => {
    setChartType(nextType);
  };

  if (!node || !staticNode) {
    if (nodesLoading) {
      return (
        <div className="flex items-center justify-center h-full">
          <Loading text={t("instancePage.loadingNodeInfo")} />
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center h-full">
        {t("instancePage.nodeNotFound")}
      </div>
    );
  }

  return (
    <div className="text-card-foreground space-y-4 my-4 @container">
      <Card className="flex items-center justify-between p-4 mb-4 text-primary">
        <div className="flex items-center gap-2 min-w-0">
          <Button
            className="flex-shrink-0"
            variant="outline"
            size="icon"
            aria-label="收起机器详情"
            onClick={() => navigate(-1)}>
            <ArrowLeft />
          </Button>
          <div className="flex items-center gap-2 min-w-0">
            <Flag flag={node.region}></Flag>
            <span className="text-xl md:text-2xl font-bold">{node.name}</span>
          </div>
          <span className="text-sm text-secondary-foreground flex-shrink-0">
            {isOnline ? t("node.online") : t("node.offline")}
          </span>
        </div>
        {canManageBilling && <Button type="button" size="sm" variant="outline" className="ml-2 shrink-0"
          aria-expanded={billingOpen} onClick={() => setBillingNode(billingOpen ? null : node.uuid)}>
          流量设置
        </Button>}
      </Card>

      {billingOpen && <Card><NodeBillingSettings key={node.uuid} uuid={node.uuid} /></Card>}
      {enableInstanceDetail && node && <Instance node={node} />}

      <div id="instance-chart-controls" className="flex flex-col items-center w-full space-y-4 scroll-mt-4">
        <Card className="p-2">
          <div className="kp-tabs flex justify-center space-x-2">
            {enableTrafficForecast && <Button aria-pressed={chartType === 'forecast'} variant={chartType === "forecast" ? "default" : "ghost"} size="sm" onClick={() => handleChartTypeChange("forecast")}>
              流量预测
            </Button>}
            {enableUnlockTest && <Button
              aria-pressed={chartType === 'unlock'}
              variant={chartType === "unlock" ? "default" : "ghost"}
              size="sm"
              onClick={() => handleChartTypeChange("unlock")}>
              流媒体检测
            </Button>}
            <Button
              aria-pressed={chartType === 'load'}
              variant={chartType === "load" ? "default" : "ghost"}
              size="sm"
              onClick={() => handleChartTypeChange("load")}>
              {t("instancePage.optionLoad")}
            </Button>
            {enablePingChart && (
              <Button
                aria-pressed={chartType === 'ping'}
                variant={chartType === "ping" ? "default" : "ghost"}
                size="sm"
                onClick={() => handleChartTypeChange("ping")}>
                {t("instancePage.optionPing")}
              </Button>
            )}
          </div>
        </Card>
        {(chartType === "load" || chartType === "ping") && <Card className={`justify-center p-2 ${isMobile ? "w-full" : ""}`}>
          {chartType === "load" ? (
            <div className="flex space-x-2 overflow-x-auto whitespace-nowrap">
              {loadTimeRanges.map((range) => (
                <Button
                  key={range.label}
                  variant={loadHours === range.hours ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setLoadHours(range.hours)}>
                  {range.label}
                </Button>
              ))}
            </div>
          ) : (
            <div className="flex space-x-2 overflow-x-auto whitespace-nowrap">
              {pingTimeRanges.map((range) => (
                <Button
                  key={range.label}
                  variant={pingHours === range.hours ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setPingHours(range.hours)}>
                  {range.label}
                </Button>
              ))}
            </div>
          )}
        </Card>}
      </div>

      <div>
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-96">
              <Loading text={t("chart.loading")} />
            </div>
          }>
          {chartType === "forecast" && <TrafficForecastPanel key={node.uuid} uuid={node.uuid} />}
          {chartType === "unlock" && <UnlockPanel key={node.uuid} uuid={node.uuid} />}
          {chartType === "load" && staticNode ? (
            <LoadCharts
              node={staticNode}
              hours={loadHours}
              liveData={stats}
              isOnline={isOnline}
            />
          ) : chartType === "ping" && staticNode ? (
            <PingChart node={staticNode} hours={pingHours} />
          ) : null}
        </Suspense>
      </div>
    </div>
  );
};

export default InstancePage;
