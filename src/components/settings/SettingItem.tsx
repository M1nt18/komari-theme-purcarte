import { useState } from "react";
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
  pingTasks: readonly string[];
}

const SettingItem = ({
  item,
  editingConfig,
  onConfigChange,
  pingTasks,
}: SettingItemProps) => {
  const defaultValue = item.default;
  const currentValue =
    editingConfig[item.key as keyof ConfigOptions] ?? defaultValue;
  const isModified = currentValue !== defaultValue;
  const [numberText, setNumberText] = useState<string | null>(null);
  const bounds = item.type === "number" ? numericLimits[item.key] : undefined;
  const update = (value: unknown) => onConfigChange(item.key, value);

  const renderInput = () => {
    switch (item.type) {
      case "number":
        return (
          <Input
            type="number"
            min={bounds?.[0]}
            max={bounds?.[1]}
            aria-label={item.name}
            className="theme-card-style"
            value={numberText ?? currentValue}
            onChange={event => {
              const { value, valueAsNumber } = event.currentTarget;
              setNumberText(value);
              if (Number.isFinite(valueAsNumber) &&
                  (!bounds || (valueAsNumber >= bounds[0] && valueAsNumber <= bounds[1]))) {
                update(valueAsNumber);
              }
            }}
            onBlur={event => {
              setNumberText(null);
              const parsed = event.currentTarget.valueAsNumber;
              if (bounds && Number.isFinite(parsed)) {
                const clamped = Math.max(bounds[0], Math.min(bounds[1], parsed));
                if (clamped !== currentValue) update(clamped);
              }
            }}
          />
        );
      case "string":
        return (
          <Input
            type="text"
            aria-label={item.name}
            className="theme-card-style"
            maxLength={100000}
            value={currentValue}
            onChange={event => update(event.currentTarget.value)}
          />
        );
      case "switch":
        return (
          <Switch
            aria-label={item.name}
            checked={currentValue}
            onCheckedChange={update}
          />
        );
      case "select":
        return (
          <Select
            value={currentValue}
            onValueChange={update}>
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
            value={currentValue ? `task:${currentValue}` : "default"}
            onValueChange={value => update(value === "default" ? "" : value.slice(5))}>
            <SelectTrigger aria-label={item.name}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">默认（网格优先电信，紧凑取平均）</SelectItem>
              {currentValue && !pingTasks.includes(currentValue) &&
                <SelectItem value={`task:${currentValue}`}>{currentValue}</SelectItem>}
              {pingTasks.map((taskName) => (
                <SelectItem key={taskName} value={`task:${taskName}`}>
                  {taskName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case "node-ping-task-map":
        return <NodeTaskSettings value={String(currentValue || "{}")} onChange={update} tasks={pingTasks} />;
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
