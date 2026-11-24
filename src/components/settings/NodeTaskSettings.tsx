import { useNodeData } from '@/contexts/NodeDataContext';

interface NodeTaskSettingsProps {
  value: string;
  onChange: (value: string) => void;
  tasks: readonly string[];
}

export default function NodeTaskSettings({ value, onChange, tasks }: NodeTaskSettingsProps) {
  const { nodes } = useNodeData();
  let mapping: Record<string, string> = {};
  try {
    mapping = JSON.parse(value) || {};
  } catch {
    // The settings model validates imported mappings before use.
  }
  return <div className="space-y-2">{nodes.map(node => {
    const selected = mapping[node.uuid] || "";
    return <label key={node.uuid} className="flex items-center justify-between gap-2">
      <span className="truncate text-sm">{node.name}</span>
      <select aria-label={`${node.name} 的卡片延迟任务`} value={selected}
        className="min-w-28 max-w-44 rounded border border-(--accent-5) bg-(--color-background) p-2 text-sm"
        onChange={event => {
          const next = { ...mapping };
          if (event.target.value) next[node.uuid] = event.target.value;
          else delete next[node.uuid];
          onChange(JSON.stringify(next));
        }}>
        <option value="">跟随默认任务</option>
        {selected && !tasks.includes(selected) && <option value={selected}>{selected}</option>}
        {tasks.map(task => <option value={task} key={task}>{task}</option>)}
      </select>
    </label>;
  })}</div>;
}
