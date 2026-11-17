import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { TrendingUp } from "lucide-react";
import "./netforecast.css";
const TrafficForecastPanel = lazy(() => import("./TrafficForecastPanel"));

export default function ForecastOverviewLauncher({
  onOpenNode,
}: {
  onOpenNode: (uuid: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  function showOverview() {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    setOpen(true);
  }

  useEffect(() => {
    if (window.location.hash === "#traffic") showOverview();
  }, []);

  function closeOverview() {
    dialog.current?.close();
  }

  return (
    <>
      <button
        type="button"
        className="nf-home-launcher"
        onClick={showOverview}
        aria-label="打开流量预测总览"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <TrendingUp size={16} />
        <span>流量预测</span>
      </button>
      <dialog
        ref={dialog}
        className="nf-overview-dialog"
        aria-label="流量预测总览"
        onClose={() => {
          setOpen(false);
          if (window.location.hash === "#traffic") {
            window.history.replaceState(
              window.history.state,
              "",
              window.location.pathname + window.location.search,
            );
          }
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeOverview();
        }}
      >
        {open && (
          <Suspense fallback={<div className="nf-empty">正在读取流量预测…</div>}><TrafficForecastPanel
            onClose={closeOverview}
            onOpenNode={(uuid) => {
              closeOverview();
              onOpenNode(uuid);
            }}
          /></Suspense>
        )}
      </dialog>
    </>
  );
}
