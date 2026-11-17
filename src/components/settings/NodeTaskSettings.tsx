import { useEffect,useState } from 'react';
import { useNodeData } from '@/contexts/NodeDataContext';
import { apiService } from '@/services/api';

export default function NodeTaskSettings({value,onChange}:{value:string;onChange:(value:string)=>void}){
  const {nodes}=useNodeData();const [tasks,setTasks]=useState<Array<{id:number;name:string}>>([]);
  useEffect(()=>{let active=true;void apiService.get<{id:number;name:string}[]>('/api/task/ping').then(result=>{if(active&&Array.isArray(result.data))setTasks(result.data);});return()=>{active=false;};},[]);
  let mapping:Record<string,string>={};try{mapping=JSON.parse(value)||{};}catch{/* validated on save */}
  return <div className="space-y-2">{nodes.map(node=><label key={node.uuid} className="flex items-center justify-between gap-2">
    <span className="truncate text-sm">{node.name}</span>
    <select aria-label={`${node.name} 的卡片延迟任务`} value={mapping[node.uuid]||''} className="min-w-28 max-w-44 rounded border border-(--accent-5) bg-(--color-background) p-2 text-sm"
      onChange={event=>{const next={...mapping};if(event.target.value)next[node.uuid]=event.target.value;else delete next[node.uuid];onChange(JSON.stringify(next));}}>
      <option value="">跟随默认任务</option>
      {mapping[node.uuid]&&!tasks.some(task=>task.name===mapping[node.uuid])&&<option value={mapping[node.uuid]}>{mapping[node.uuid]}</option>}
      {tasks.map(task=><option value={task.name} key={task.id}>{task.name}</option>)}
    </select>
  </label>)}</div>;
}
