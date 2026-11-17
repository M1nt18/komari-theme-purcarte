import { cycleDate, cycleProgress, precisePercent } from './cycle-progress';
import type { CycleInput } from './cycle-progress';
import './cycle-traffic-bar.css';

export function CycleTrafficBar({ quota, now }: { quota: CycleInput; now: number }) {
  const state = cycleProgress(quota, now);
  if (!state.current) {
    return <div className="ctb" aria-label="流量数据待同步">
      <div className="ctb-track" />
      <div className="ctb-caption"><span>待同步</span></div>
    </div>;
  }
  if (!state.limited) {
    return <div className="ctb ctb-unlimited">
      <div className="ctb-track" aria-hidden="true" />
      <div className="ctb-caption"><span>不限量</span></div>
    </div>;
  }
  const elapsed = precisePercent(state.elapsed!);
  const used = precisePercent(state.usage!);
  const reset = cycleDate(quota.period_end);
  const title = `本周期 ${cycleDate(quota.period_start)} 至 ${reset}（北京时间）\n已用流量 ${used}；周期已过 ${elapsed}\n竖线表示今天在周期中的位置；${reset} 00:00 重置，剩余 ${state.remainingDays} 天`;
  return <div className={`ctb ctb-${state.tone}`} title={title}>
    <div className="ctb-meter" role="progressbar" aria-label="本周期流量使用"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.fill}
      aria-valuetext={`流量已用 ${used}，周期已过 ${elapsed}，${reset} 重置`}>
      <div className="ctb-track"><div className="ctb-fill" style={{ width: `${state.fill}%` }} /></div>
      <span className="ctb-today" style={{ left: `${state.elapsed}%` }}
        title={`周期已过 ${elapsed}`} />
    </div>
    <div className="ctb-caption">
      <span>已用 <b>{used}</b></span>
      <span>{reset} 重置</span>
    </div>
  </div>;
}
