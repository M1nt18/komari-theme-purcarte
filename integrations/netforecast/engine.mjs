// Calendar and billing helpers adapted from Komari-Plugin-NetForecast (MIT).
// Upstream commit 7dd815f0e1a711f2192d3f5f270156a44f6b96ac; see UPSTREAM-LICENSE.txt.
function getDaysInMonth(year, month) { return new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); }

export function computeBillableAmount(inBytes, outBytes, mode = "sum") {
  const m = (mode || "sum").toLowerCase();
  switch (m) {
    case "upload":
    case "up":
      return outBytes;
    case "download":
    case "down":
      return inBytes;
    case "max":
      return Math.max(inBytes, outBytes);
    case "min":
      return Math.min(inBytes, outBytes);
    case "sum":
    default:
      return inBytes + outBytes;
  }
}

function getTzDateParts(now = new Date(), tzOffsetHours = 8) {
  const tzOffsetMs = Number(tzOffsetHours) * 3600 * 1000;
  const d = new Date(now.getTime() + tzOffsetMs);
  const pad2 = (n) => String(n).padStart(2, "0");
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    date: d.getUTCDate(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
    seconds: d.getUTCSeconds(),
    dateStr: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`,
  };
}

/**
 * 计算账单周期范围 (支持用户自定义时区偏移，彻底规避宿主机/容器时区干扰)
 */
export function calculateBillingCycle(resetDay = 1, now = new Date(), tzOffsetHours = 8) {
  const tzParts = getTzDateParts(now, tzOffsetHours);
  const currentYear = tzParts.year;
  const currentMonth = tzParts.month;
  const currentDate = tzParts.date;

  const safeResetDay = Math.max(1, Math.min(31, Math.floor(Number(resetDay) || 1)));

  // 当前月的实际月末重置日（例如 4 月是 30，2 月是 28 或 29，防止设置 31 号的节点在小月末无法进入新周期）
  const maxDayThisMonth = getDaysInMonth(currentYear, currentMonth);
  const actualResetDayThisMonth = Math.min(safeResetDay, maxDayThisMonth);

  let cycleStartYear, cycleStartMonth, cycleStartDay;
  let cycleEndYear, cycleEndMonth, cycleEndDay;

  if (currentDate >= actualResetDayThisMonth) {
    cycleStartYear = currentYear;
    cycleStartMonth = currentMonth;
    cycleStartDay = actualResetDayThisMonth;

    const nextMonthYear = currentMonth === 11 ? currentYear + 1 : currentYear;
    const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
    const maxDayNextMonth = getDaysInMonth(nextMonthYear, nextMonth);
    cycleEndYear = nextMonthYear;
    cycleEndMonth = nextMonth;
    cycleEndDay = Math.min(safeResetDay, maxDayNextMonth);
  } else {
    const prevMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const maxDayPrevMonth = getDaysInMonth(prevMonthYear, prevMonth);
    cycleStartYear = prevMonthYear;
    cycleStartMonth = prevMonth;
    cycleStartDay = Math.min(safeResetDay, maxDayPrevMonth);

    cycleEndYear = currentYear;
    cycleEndMonth = currentMonth;
    cycleEndDay = actualResetDayThisMonth;
  }

  const tzMs = Number(tzOffsetHours) * 3600 * 1000;
  const cycleStartUtcMs = Date.UTC(cycleStartYear, cycleStartMonth, cycleStartDay, 0, 0, 0, 0) - tzMs;
  const cycleEndUtcMs = Date.UTC(cycleEndYear, cycleEndMonth, cycleEndDay, 0, 0, 0, 0) - tzMs;

  const cycleStartDate = new Date(cycleStartUtcMs);
  const cycleEndDate = new Date(cycleEndUtcMs);

  const oneDayMs = 24 * 60 * 60 * 1000;
  const daysTotal = Math.max(1, Math.round((cycleEndUtcMs - cycleStartUtcMs) / oneDayMs));
  const daysElapsed = Math.max(1, Math.min(daysTotal, Math.ceil((now.getTime() - cycleStartUtcMs) / oneDayMs)));
  const daysRemaining = Math.max(0, daysTotal - daysElapsed);

  const pad2 = (n) => String(n).padStart(2, "0");
  const cycleStartStr = `${cycleStartYear}-${pad2(cycleStartMonth + 1)}-${pad2(cycleStartDay)}`;
  const cycleEndStr = `${cycleEndYear}-${pad2(cycleEndMonth + 1)}-${pad2(cycleEndDay)}`;

  return {
    cycleStart: cycleStartStr,
    cycleEnd: cycleEndStr,
    cycleStartDate,
    cycleEndDate,
    daysTotal,
    daysElapsed,
    daysRemaining,
    timezoneOffset: tzOffsetHours,
  };
}
