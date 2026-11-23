/** Paint the existing right-aligned bars in a single layer. */
export function pingBarStrip(colors: readonly string[], slots: number) {
  const count = Math.max(colors.length, slots);
  const stops = colors.flatMap((color, index) => {
    const left = (count - colors.length + index) / count;
    const right = left + 1 / count;
    // Each grid slot shares the available width with a two-pixel gap.
    const start = `calc(${left * 100}% + min(${left * 2}px, ${left * 50 / count}%))`;
    const remaining = Math.max(0, 1 - right);
    const end = `calc(${right * 100}% - min(${remaining * 2}px, ${remaining * 50 / count}%))`;
    return [`transparent ${start}`, `${color} ${start} ${end}`, `transparent ${end}`];
  });
  return `linear-gradient(to right, ${stops.join(", ")})`;
}
