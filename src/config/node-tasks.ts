import type { PingTask } from "@/types/node";

export function nodeTaskName(mapping: string, uuid: string, fallback: string, defaultTask: string) {
  try {
    const value = JSON.parse(mapping)?.[uuid];
    if (typeof value === "string" && value.trim()) return value.trim();
  } catch {
    // Use the configured fallback if a legacy mapping cannot be parsed.
  }
  return fallback.trim() || defaultTask;
}

export function selectCardPingTasks(tasks: readonly Pick<PingTask, "id" | "name">[], name: string, fallbackTaskId: number) {
  if (!name) return tasks;

  const task = tasks.find(item => item.name === name)
    ?? tasks.find(item => item.name.includes(name))
    ?? tasks.find(item => item.id === fallbackTaskId)
    ?? tasks[0];
  return task ? [task] : [];
}
