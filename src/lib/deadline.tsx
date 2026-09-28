// 截止日（DDL）倒计时徽章：文案 + 亮/暗双套样式
// 看板卡片、近期节点、名录行/卡片共用，保证同一日期在各处呈现一致
// 注意区分两种 DDL：企业秋招网申截止（company.deadline）与用户投递记录的关键节点（application.deadline）

import { Clock } from "lucide-react"
import { dateLabel, daysUntil, toShanghaiDateStr } from "@/lib/date"
import { cn } from "@/lib/utils"

export function deadlineBadge(deadline: string | null | undefined): { text: string; cls: string } | null {
  if (!deadline) return null
  const d = daysUntil(deadline)
  if (d < 0)
    return {
      text: `已过 ${Math.abs(d)} 天`,
      cls: "border-border bg-secondary/60 text-muted-foreground/70",
    }
  if (d === 0)
    return {
      text: "今天到期",
      cls: "border-[color:var(--crimson)]/55 bg-[color:var(--crimson-soft)] text-[color:var(--crimson-deep)] font-medium",
    }
  if (d <= 3)
    return {
      text: `剩 ${d} 天`,
      cls: "border-[color:var(--crimson)]/35 bg-[color:var(--crimson-soft)]/70 text-[color:var(--crimson-deep)]",
    }
  if (d <= 7)
    return {
      text: `剩 ${d} 天`,
      cls: "border-primary/25 bg-accent text-accent-foreground/90",
    }
  return {
    text: dateLabel(toShanghaiDateStr(deadline)),
    cls: "border-border/80 bg-card text-muted-foreground/75",
  }
}

/** DDL 徽章的紧凑变体：名录行/卡片内与状态徽章并排 */
export function DeadlineChip({ deadline, className }: { deadline: string | null | undefined; className?: string }) {
  const ddl = deadlineBadge(deadline)
  if (!ddl) return null
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-px text-[10.5px] tabular-nums",
        ddl.cls,
        className
      )}
    >
      {ddl.text}
    </span>
  )
}

/** 企业秋招网申截止信息（company.deadline，ISO 或 YYYY-MM-DD） */
export interface CompanyDdl {
  /** 上海时区 YYYY-MM-DD */
  day: string
  /** 距截止日天数（上海日历日）：<0 已过，0 今天，>0 剩余 */
  d: number
}

export function companyDeadline(deadline: string | null | undefined): CompanyDdl | null {
  if (!deadline) return null
  const day = toShanghaiDateStr(deadline)
  return { day, d: daysUntil(day) }
}

/**
 * 企业网申截止徽章：绯红描边风 + 时钟图标 +「网申截止」前缀，
 * 与投递记录的 DeadlineChip（中性描边）并排时视觉不撞车。
 * 语义：>7 天显示日期，≤7 天显示「剩 N 天」，今天「今天」，已过灰显「已过」。
 */
export function CompanyDeadlineChip({
  deadline,
  className,
}: {
  deadline: string | null | undefined
  className?: string
}) {
  const ddl = companyDeadline(deadline)
  if (!ddl) return null
  const expired = ddl.d < 0
  const short = expired ? "已过" : ddl.d === 0 ? "今天" : ddl.d <= 7 ? `剩 ${ddl.d} 天` : dateLabel(ddl.day)
  return (
    <span
      title={expired ? `网申已于 ${ddl.day} 截止` : `网申截止 ${ddl.day}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-px text-[10.5px] tabular-nums",
        expired
          ? "border-border bg-secondary/60 text-muted-foreground/70"
          : ddl.d === 0
            ? "border-[color:var(--crimson)]/60 bg-[color:var(--crimson-soft)] font-medium text-[color:var(--crimson-deep)]"
            : ddl.d <= 7
              ? "border-[color:var(--crimson)]/45 bg-[color:var(--crimson-soft)]/70 text-[color:var(--crimson-deep)]"
              : "border-[color:var(--crimson)]/30 bg-[color:var(--crimson-soft)]/45 text-[color:var(--crimson-deep)]/85",
        className
      )}
    >
      <Clock aria-hidden className="size-3" strokeWidth={1.8} />
      网申截止{expired ? "已过" : ` · ${short}`}
    </span>
  )
}
