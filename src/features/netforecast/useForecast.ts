import { useEffect, useState } from 'react';
import type { ForecastOverview } from './types';
import { adaptForecastPayload, forecastExpiresAt } from '../../../integrations/netforecast/from-ledger.mjs';

export function useForecast(enabled: boolean) {
  const [data,setData]=useState<ForecastOverview|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    if(!enabled)return;
    let active=true,pending=false,lastAttempt=-Infinity,expires=0,received=0,serverTime=0;
    let controller:AbortController|undefined;
    const now=()=>serverTime+performance.now()-received;
    const load=async()=>{
      if(pending||document.hidden)return;
      pending=true;lastAttempt=performance.now();controller=new AbortController();
      const requestController=controller;
      const timeout=setTimeout(()=>requestController.abort(),12000);
      setLoading(true);
      try {
        const response=await fetch('/api/plugin/net-forecast/overview',{credentials:'same-origin',cache:'no-store',signal:requestController.signal});
        if(!response.ok)throw new Error('暂时无法读取流量预测，请稍后刷新。');
        const result=adaptForecastPayload(await response.json());
        if(!result.ok||!Array.isArray(result.nodes))throw new Error('流量预测数据格式异常。');
        if(!active)return;
        expires=forecastExpiresAt(result);received=performance.now();serverTime=Date.parse(result.generated_at||'');
        setData(result);setError(null);
      }catch(reason){
        if(active){
          if(!expires||now()>=expires)setData(null);
          setError(reason instanceof Error?reason.message:'暂时无法读取流量预测。');
        }
      }finally{
        clearTimeout(timeout);pending=false;if(active)setLoading(false);
      }
    };
    const tick=()=>{
      if(expires&&now()>=expires){setData(null);expires=0;setError('快照已过期，正在读取当前周期。');void load();}
      if(!document.hidden&&performance.now()-lastAttempt>=30000)void load();
    };
    const resume=()=>{tick();void load();};
    void load();const timer=setInterval(tick,1000);
    document.addEventListener('visibilitychange',resume);
    return()=>{active=false;controller?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',resume);};
  },[enabled,revision]);
  return {data,loading,error,refresh:()=>setRevision(v=>v+1)};
}
