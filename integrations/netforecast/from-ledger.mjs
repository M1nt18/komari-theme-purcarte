import * as engine from './engine.mjs';
const DAY = 86400000;
const dateAt = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);

export function adaptForecastPayload(payload) {
  if (payload?.source !== 'persistent-ledger') return payload;
  const now = Date.parse(payload.generated_at), synced = Date.parse(payload.last_sync);
  if (!Array.isArray(payload.nodes) || !Number.isFinite(now) || !Number.isFinite(synced) || now-synced > 120000) {
    throw new Error('流量账本暂未同步，请稍后刷新。');
  }
  const today = Math.floor((now + 8*3600000)/DAY)*DAY - 8*3600000;
  const nodes = payload.nodes.map(({ uuid, name, quota: q, history }) => {
    const cycle = engine.calculateBillingCycle(q.reset_day, new Date(now), 8);
    const start = cycle.cycleStartDate.getTime(), end = cycle.cycleEndDate.getTime();
    cycle.daysRemaining = Math.max(0, Math.ceil((end-now)/DAY));
    const recent = history.filter(h => h.timestamp >= today-7*DAY && h.timestamp < today);
    const complete = recent.filter(h => h.complete === true || (h.complete === undefined && h.samples >= 96));
    const weighted = field => {
      if (!complete.length) return NaN;
      let sum=0,weights=0;
      for (const h of complete) {
        const weight=1+((h.timestamp-(today-7*DAY))/DAY)/7*1.2;
        sum+=(h[field] || 0)*weight;weights+=weight;
      }
      return sum/weights;
    };
    const avgIn=weighted('in_bytes'),avgOut=weighted('out_bytes');
    const available=complete.length>0;
    const bill=(incoming,outgoing)=>engine.computeBillableAmount(incoming,outgoing,q.billing_mode);
    const adjustment=q.used_bytes-bill(q.download_bytes,q.upload_bytes);
    const project=days=>{
      if (!available) return NaN;
      if (q.calibration) return q.calibration.amount+bill(
        Math.max(0,q.download_bytes-q.calibration.download_anchor)+avgIn*days,
        Math.max(0,q.upload_bytes-q.calibration.upload_anchor)+avgOut*days);
      return Math.max(0,adjustment+bill(q.download_bytes+avgIn*days,q.upload_bytes+avgOut*days));
    };
    const remaining=Math.max(0,(end-now)/DAY),predicted=project(remaining);
    const hasQuota=q.limit_bytes>0;
    const ratio=hasQuota&&available ? predicted/q.limit_bytes : 0;
    const exhausted=hasQuota&&q.used_bytes>=q.limit_bytes;
    const status=!hasQuota?'NO_QUOTA':exhausted||ratio>=1?'CRITICAL':ratio>=.9?'WARNING':'SAFE';
    let exhaustion;
    if (exhausted) exhaustion=0;
    else if (available && hasQuota && ratio>=1) {
      let lo=0,hi=remaining;
      for(let i=0;i<40;i++){const mid=(lo+hi)/2;if(project(mid)>=q.limit_bytes)hi=mid;else lo=mid;}
      exhaustion=Math.max(1,Math.ceil(hi));
    }
    const map=new Map(history.map(h=>[h.date,h]));let incoming=0,outgoing=0;
    const chart=[];
    for(let at=start;at<=end;at+=DAY){
      const date=dateAt(at),h=map.get(date),isToday=at===today,future=at>today;
      if(h&&!future){incoming+=h.in_bytes||0;outgoing+=h.out_bytes||0;}
      chart.push({date,timestamp:at,in_bytes:future?0:h?.in_bytes||0,out_bytes:future?0:h?.out_bytes||0,
        total_bytes:future?0:(h?.in_bytes||0)+(h?.out_bytes||0),
        has_data:!future&&Boolean(h),is_today:isToday,is_forecast:future,
        cumulative_billable:future?(available?project(Math.max(0,(at-now)/DAY)):null)
          :isToday?q.used_bytes:h?Math.max(0,adjustment+bill(incoming,outgoing)):null});
    }
    return {node_id:uuid,node_name:name,has_quota:hasQuota,traffic_limit_bytes:q.limit_bytes,
      traffic_limit_type:q.billing_mode,traffic_reset_day:q.reset_day,cycle,
      period_end:new Date(end).toISOString(),
      cumulative:{in_bytes:q.download_bytes,out_bytes:q.upload_bytes,billable_bytes:q.used_bytes},
      daily_avg:{in_bytes:avgIn,out_bytes:avgOut,billable_bytes:bill(avgIn,avgOut)},
      projected:{in_bytes:q.download_bytes+avgIn*remaining,out_bytes:q.upload_bytes+avgOut*remaining,billable_bytes:predicted},
      usage_ratio:ratio,status,days_until_exhaustion:exhaustion,chart_series:chart,
      sample_days:complete.length,partial_days:recent.length-complete.length,forecast_available:available,
      history_partial:q.history_partial||q.coverage_ratio<.95,fetch_failed:!q.sample_at};
  });
  return {ok:true,generated_at:payload.generated_at,last_sync:payload.last_sync,
    summary:{total_nodes:nodes.length,timezone_offset:8},nodes};
}

export function forecastExpiresAt(data) {
  const generated=Date.parse(data?.generated_at||'');
  if(!Number.isFinite(generated))return 0;
  const boundaries=(data.nodes||[]).map(n=>Date.parse(n.period_end||`${n.cycle.cycleEnd}T00:00:00+08:00`));
  return Math.min(generated+120000,...boundaries);
}
