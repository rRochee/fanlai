// 饭来 · 日期工具（统一按 Asia/Shanghai 处理）
const TZ = "Asia/Shanghai"

const ymdFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }) // YYYY-MM-DD

export function shanghaiToday(): string {
  return ymdFmt.format(new Date())
}

export function toShanghaiDateStr(d: Date | string): string {
  return ymdFmt.format(new Date(d))
}

const labelFmt = new Intl.DateTimeFormat("zh-CN", {
  timeZone: TZ,
  month: "long",
  day: "numeric",
})

const weekdayFmt = new Intl.DateTimeFormat("zh-CN", {
  timeZone: TZ,
  weekday: "long",
})

export function dateLabel(dateStr: string): string {
  return labelFmt.format(new Date(`${dateStr}T12:00:00+08:00`))
}

export function weekdayLabel(dateStr: string): string {
  return weekdayFmt.format(new Date(`${dateStr}T12:00:00+08:00`))
}

export function shiftDateStr(dateStr: string, offsetDays: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

/** 解析 YYYY-MM-DD 为 UTC 午夜 Date（存储口径） */
export function parseDateStr(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`)
}

/** 距离目标日期还剩几天（按上海日历日；目标日=今天 → 0，已过为负数） */
export function daysUntil(target: Date | string, todayStr = shanghaiToday()): number {
  const targetStr = toShanghaiDateStr(target)
  const a = Date.parse(`${targetStr}T00:00:00Z`)
  const b = Date.parse(`${todayStr}T00:00:00Z`)
  return Math.round((a - b) / (24 * 3600 * 1000))
}
