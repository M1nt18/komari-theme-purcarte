import { DEFAULT_CONFIG } from './default.ts';
import type { ConfigOptions } from './default';

const enums:Record<string,readonly string[]>={
  selectedDefaultView:['grid','compact','table'],selectMobileDefaultView:['grid','compact','table'],
  selectedDefaultAppearance:['light','dark','system'],selectedHeaderStyle:['fixed','levitation'],
  selectedFooterStyle:['fixed','levitation','followContent','hidden'],selectTrafficProgressStyle:['linear','circular'],
  selectThemeColor:['ruby','gray','gold','bronze','brown','yellow','amber','orange','tomato','red','crimson','pink','plum','purple','violet','iris','indigo','blue','cyan','teal','jade','green','grass','lime','mint','sky'],
};
export const numericLimits:Record<string,[number,number]>={
  mainWidth:[50,100],blurValue:[0,40],pingChartTimeInPreview:[1,720],pingChartMaxPoints:[0,20000],
  cardPingChartFallbackTaskId:[0,2147483647],cardPingChartHours:[1,720],cardPingChartMaxBars:[8,60],
};
export function normalizeSettings(input:unknown,strict=false):Partial<ConfigOptions>{
  for(let depth=0;depth<2&&typeof input==='string';depth++){
    try{input=JSON.parse(input);}catch{if(strict)throw new Error('配置必须是有效的 JSON 对象');return {};}
  }
  if(!input||typeof input!=='object'||Array.isArray(input)){
    if(strict)throw new Error('配置必须是 JSON 对象');return {};
  }
  const raw={...input} as Record<string,unknown>;
  if(raw.backgroundAlignment===undefined&&typeof raw.backagroundAlignment==='string')raw.backgroundAlignment=raw.backagroundAlignment;
  const output:Record<string,unknown>={};
  for(const [key,defaultValue]of Object.entries(DEFAULT_CONFIG)){
    if(!Object.prototype.hasOwnProperty.call(raw,key))continue;
    const value=raw[key];
    const valid=typeof value===typeof defaultValue
      &&(typeof value!=='number'||Number.isFinite(value))
      &&(!enums[key]||enums[key].includes(value as string))
      &&(!numericLimits[key]||(Number(value)>=numericLimits[key][0]&&Number(value)<=numericLimits[key][1]))
      &&(typeof value!=='string'||value.length<=100000);
    if(!valid){if(strict)throw new Error(`设置 ${key} 的类型或取值无效`);continue;}
    if(key==='cardPingChartNodeTasks'){
      try{
        const map=JSON.parse(String(value)||'{}');
        if(!map||typeof map!=='object'||Array.isArray(map)||Object.values(map).some(v=>typeof v!=='string'||v.length>200))throw new Error();
      }catch{if(strict)throw new Error('各节点延迟任务必须是有效映射');continue;}
    }
    output[key]=value;
  }
  return output as Partial<ConfigOptions>;
}

export function settingsSignature(value:Partial<ConfigOptions>){
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))));
}
