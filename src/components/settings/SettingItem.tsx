import { useState, useEffect } from "react";
import { useNodeData } from "@/contexts/NodeDataContext";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ConfigOptions } from "@/config/default";
import { numericLimits } from '@/config/settings-model';
import NodeTaskSettings from './NodeTaskSettings';

interface SettingItemProps {
  item: any;
  editingConfig: Partial<ConfigOptions>;
  onConfigChange: (key: keyof ConfigOptions, value: any) => void;
}

const SettingItem = ({
  item,
  editingConfig,
  onConfigChange,
}: SettingItemProps) => {
  const { nodes, getPingHistory } = useNodeData();
  const defaultValue = item.default;
  const currentValue =
    editingConfig[item.key as keyof ConfigOptions] ?? defaultValue;
  const isModified = currentValue !== defaultValue;
  const [localValue, setLocalValue] = useState(currentValue);
  const [pingTasks, setPingTasks] = useState<string[]>([]);

  useEffect(() => {
    setLocalValue(currentValue);
  }, [currentValue]);

  useEffect(() => {
    if (item.type !== "ping-task-select") return;
    let cancelled = false;

    const loadPingTasks = async () => {
      for (const node of nodes) {
        const history = await getPingHistory(node.uuid, 1);
        const names =
          history?.tasks
            ?.map((task) => task.name)
            .filter((name): name is string => Boolean(name)) ?? [];
        if (names.length && !cancelled) {
          setPingTasks(Array.from(new Set(names)));
          return;
        }
      }
      if (!cancelled) setPingTasks([]);
    };

    loadPingTasks();
    return () => {
      cancelled = true;
    };
  }, [getPingHistory, item.type, nodes]);

  const handleBlur = () => {
    if (item.type === "number") {
      const bounds=numericLimits[item.key];
      const parsed=Number(localValue);
      const value=Number.isFinite(parsed)?bounds?Math.max(bounds[0],Math.min(bounds[1],parsed)):parsed:currentValue;
      setLocalValue(value);onConfigChange(item.key,value);
    } else {
      onConfigChange(item.key, localValue);
    }
  };

  const renderInput = () => {
    switch (item.type) {
      case "number":
        return (
          <Input
            type="number"
            min={numericLimits[item.key]?.[0]}
            max={numericLimits[item.key]?.[1]}
            aria-label={item.name}
            className="theme-card-style"
            value={localValue as number}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={handleBlur}
          />
        );
      case "string":
        return (
          <Input
            type="text"
            aria-label={item.name}
            className="theme-card-style"
            value={localValue as string}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={handleBlur}
          />
        );
      case "switch":
        return (
          <Switch
            aria-label={item.name}
            checked={localValue as boolean}
            onCheckedChange={(checked) => {
              setLocalValue(checked);
              onConfigChange(item.key, checked);
            }}
          />
        );
      case "select":
        return (
          <Select
            value={localValue as string}
            onValueChange={(value) => {
              setLocalValue(value);
              onConfigChange(item.key, value);
            }}>
            <SelectTrigger aria-label={item.name}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {item.options.split(",").map((option: string) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case "ping-task-select":
        return (
          <Select
            value={(localValue as string) || "__average__"}
            onValueChange={(value) => {
              const nextValue = value === "__average__" ? "" : value;
              setLocalValue(nextValue);
              onConfigChange(item.key, nextValue);
            }}>
            <SelectTrigger aria-label={item.name}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__average__">全部平均</SelectItem>
              {pingTasks.map((taskName) => (
                <SelectItem key={taskName} value={taskName}>
                  {taskName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case "node-ping-task-map":
        return <NodeTaskSettings value={String(localValue||'{}')} onChange={value=>{setLocalValue(value);onConfigChange(item.key,value);}}/>;
      default:
        return null;
    }
  };

  if (item.type === "title") {
    return <h3 className="text-lg font-semibold mt-4 mb-2">{item.name}</h3>;
  }

  if (
    item.type === "switch" ||
    item.type === "select" ||
    item.type === "ping-task-select"
  ) {
    return (
      <div className="mb-4 flex items-center justify-between">
        <div>
          <span className="text-base font-bold">
            {item.name}
            {isModified && <span className="text-yellow-500 ml-2">*</span>}
          </span>
          {item.help && (
            <p className="text-sm text-gray-500 mt-1">{item.help}</p>
          )}
        </div>
        <div className="mt-2">{renderInput()}</div>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between">
        <span className="text-base font-bold">
          {item.name}
          {isModified && <span className="text-yellow-500 ml-2">*</span>}
        </span>
      </div>
      {item.help && <p className="text-sm text-gray-500 mt-1">{item.help}</p>}
      <div className="mt-2">{renderInput()}</div>
    </div>
  );
};

export default SettingItem;
