import React, { lazy, Suspense, useRef, useState } from "react";
import "./ranking.css";

const RankingPanel = lazy(() => import("./RankingPanel"));

export default function RankingLauncher({ onOpenNode }: { onOpenNode: (uuid: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <React.Fragment>
      <button type="button" className="nf-home-launcher monitoring-rank-button" ref={trigger}
        title="实时排行" aria-label="打开实时排行" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => { if (!dialog.current?.open) dialog.current?.showModal(); setOpen(true); }}>
        <span aria-hidden="true">排行</span>
      </button>
      <dialog ref={dialog} className="nf-overview-dialog monitoring-rank-dialog" aria-labelledby="monitoring-rank-title"
        onClose={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }}
        onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
        <div className="monitoring-rank-panel">
          <div className="monitoring-rank-heading">
            <h2 id="monitoring-rank-title">实时排行</h2>
            <button type="button" aria-label="关闭实时排行" onClick={() => dialog.current?.close()}>×</button>
          </div>
          {open && <Suspense fallback={<p role="status">正在读取实时排行…</p>}>
            <RankingPanel onOpenNode={uuid => { dialog.current?.close(); onOpenNode(uuid); }} />
          </Suspense>}
        </div>
      </dialog>
    </React.Fragment>
  );
}
