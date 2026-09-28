"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import { toast } from "sonner"
import {
  AlertTriangle,
  BadgeCheck,
  CalendarCheck,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Flame,
  PencilLine,
  SearchX,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { dateLabel, daysUntil, shiftDateStr, toShanghaiDateStr, weekdayLabel } from "@/lib/date"
import { companyDeadline } from "@/lib/deadline"
import { api, splitList, type Company, type DeadlinesResponse } from "@/lib/types"
import { CompanyAvatar } from "./company-avatar"
import { ViewBanner } from "./view-banner"

/**
 * 投递日历（视图 06）：全量名录的网申截止时间按月排布。
 * 可信度设计（数据来源不一，绝不装作精确）：
 * - 每条截止标注来源分层：官网来源 > 平台转载 > 转发渠道
 * - 「我已核对」确认戳：用户亲赴官网核对后打上，全站唯一可信层级
 * - 「日期有误」就地修正：修正即视为已核对
 * - 无截止情报的企业不编造，只在侧栏提示补全
 */

const WEEKDAY_HEADS = ["一", "二", "三", "四", "五", "六", "日"]

function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number)
  return `${y} 年 ${m} 月`
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

/** 「YYYY-MM」月历 6×7 网格（周一为首列），固定 42 格保持行高稳定 */
function buildGrid(month: string): { date: string; inMonth: boolean; dow: number }[] {
  const first = `${month}-01`
  const firstDow = (new Date(`${first}T12:00:00+08:00`).getDay() + 6) % 7
  const start = shiftDateStr(first, -firstDow)
  return Array.from({ length: 42 }, (_, i) => {
    const date = shiftDateStr(start, i)
    return { date, inMonth: date.slice(0, 7) === month, dow: i % 7 }
  })
}

/**
 * 连续核对天数：confirmDates 为近 30 天核对日期（升序）。
 * 今天没核对不打断连续——从昨天往回数（打卡语义：不与今天断签）。
 */
function confirmStreak(dates: string[], today: string): number {
  if (dates.length === 0) return 0
  const set = new Set(dates)
  let cursor = today
  if (!set.has(cursor)) {
    const y = shiftDateStr(today, -1)
    if (!set.has(y)) return 0
    cursor = y
  }
  let n = 0
  while (set.has(cursor)) {
    n++
    cursor = shiftDateStr(cursor, -1)
  }
  return n
}

/** 来源分层：官网直招最可信，平台转载留意转发时效，公众号/高校转发时效最弱 */
function sourceTier(c: Company): { label: string; cls: string; title: string } {
  const official =
    c.sourceType === "官网" || /careers\.|talent\.|jobs\.|官网/i.test(c.sourceName)
  if (official || c.sourceType === "官网")
    return {
      label: "官网来源",
      cls: "border-[color:var(--teal)]/40 bg-[color:var(--teal-soft)] text-[color:var(--teal-deep)]",
      title: `来源：${c.sourceName}（企业官方渠道，可信度最高）`,
    }
  if (c.sourceType === "招聘平台" || /实习僧|牛客|应届生|国聘|超级简历|实习/.test(c.sourceName))
    return {
      label: "平台转载",
      cls: "border-[color:var(--amber)]/45 bg-[color:var(--amber-soft)] text-[color:var(--amber-ink)]",
      title: `来源：${c.sourceName}（招聘平台转载，以官网为准）`,
    }
  return {
    label: "转发渠道",
    cls: "border-border bg-secondary/70 text-muted-foreground",
    title: `来源：${c.sourceName}（公众号/高校转发，务必官网核对）`,
  }
}

/** 截止日紧迫度配色（格内小圆点）：与全局 DDL 徽章同一套语义色 */
function urgencyDot(d: number): string {
  if (d < 0) return "bg-stone-300"
  if (d <= 3) return "bg-[color:var(--crimson)]"
  if (d <= 7) return "bg-primary/70"
  return "bg-border"
}

function ConfirmedBadge({ at }: { at: string | null }) {
  if (!at) {
    return (
      <span
        title="截止时间来自公开情报整理，尚未亲自到官网核对"
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-1.5 py-px text-[10.5px] text-muted-foreground"
      >
        待亲核
      </span>
    )
  }
  return (
    <span
      title={`${dateLabel(toShanghaiDateStr(at))}已在官网核对过截止时间`}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-50 px-1.5 py-px text-[10.5px] font-medium text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-950/60 dark:text-emerald-300"
    >
      <BadgeCheck className="size-3" strokeWidth={2} />
      已核对
    </span>
  )
}

/** 当日截止名单的一行：核对闭环（官网核对 → 我已核对 / 日期有误就地修正） */
function DeadlineRow({
  c,
  onDetail,
  onConfirm,
  onCorrect,
}: {
  c: Company
  onDetail: (c: Company) => void
  onConfirm: (c: Company) => Promise<void>
  onCorrect: (c: Company, date: string) => Promise<void>
}) {
  const ddl = companyDeadline(c.deadline)
  const [editing, setEditing] = useState(false)
  const [editDate, setEditDate] = useState(ddl?.day ?? "")
  const [saving, setSaving] = useState(false)
  if (!ddl) return null
  const tier = sourceTier(c)
  const positions = splitList(c.positions).slice(0, 3)

  async function saveDate() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(editDate)) {
      toast.error("请选择有效日期")
      return
    }
    setSaving(true)
    try {
      await onCorrect(c, editDate)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="border-b border-border/50 last:border-b-0">
      <div className="flex items-start gap-3 px-1 py-2.5">
        <CompanyAvatar name={c.name} className="mt-0.5 size-9 shrink-0 rounded-[7px] text-[14px]" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              onClick={() => onDetail(c)}
              className="font-display truncate text-[14.5px] font-bold tracking-wide transition-colors hover:text-primary"
            >
              {c.name}
            </button>
            <span className={cn("shrink-0 rounded-full border px-1.5 py-px text-[10.5px]", tier.cls)} title={tier.title}>
              {tier.label}
            </span>
            {c.urlStatus === "fail" && (
              <span
                title="官网自动探测不可达——招聘页可能已失效或迁移，情报请慎信，建议搜索企业名确认"
                className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-dashed border-[color:var(--crimson)]/50 px-1.5 py-px text-[10.5px] text-[color:var(--crimson-deep)]"
              >
                <AlertTriangle className="size-2.5" strokeWidth={2} />
                官网探测异常
              </span>
            )}
            <ConfirmedBadge at={c.deadlineConfirmedAt ?? null} />
          </div>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {c.industry} · {c.city}
            {positions.length > 0 && ` · ${positions.join(" / ")}`}
          </p>
          {editing ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <input
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                aria-label="修正截止日期"
                className="h-7 rounded-md border border-border bg-card px-2 text-[12px] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              />
              <button
                onClick={saveDate}
                disabled={saving}
                className="h-7 rounded-md bg-primary px-2.5 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                保存修正
              </button>
              <button
                onClick={() => setEditing(false)}
                className="h-7 rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
              >
                取消
              </button>
            </div>
          ) : (
            <p className="mt-0.5 line-clamp-1 text-[11.5px] leading-relaxed text-muted-foreground/90">{c.summary}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {editing ? (
            <span className="text-[11px] text-muted-foreground">修正后保存</span>
          ) : (
            <span
              className={cn(
                "rounded-full border px-2 py-px text-[11px] font-medium tabular-nums",
                ddl.d < 0
                  ? "border-border bg-secondary/60 text-muted-foreground"
                  : ddl.d <= 3
                    ? "border-[color:var(--crimson)]/45 bg-[color:var(--crimson-soft)] text-[color:var(--crimson-deep)]"
                    : ddl.d <= 7
                      ? "border-primary/25 bg-accent text-accent-foreground/90"
                      : "border-border/80 bg-card text-foreground/80"
              )}
            >
              {ddl.d < 0 ? `已过 ${Math.abs(ddl.d)} 天` : ddl.d === 0 ? "今天到期" : `剩 ${ddl.d} 天`}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            {c.recruitUrl ? (
              <a
                href={c.recruitUrl}
                target="_blank"
                rel="noreferrer"
                title="前往招聘官网核对截止时间"
                className="flex items-center gap-1 rounded-md border border-primary/30 bg-card px-2 py-1 text-[11.5px] font-medium text-primary transition-colors hover:border-primary/55 hover:bg-accent"
              >
                <ExternalLink className="size-3" strokeWidth={1.8} />
                官网核对
              </a>
            ) : (
              <span
                title="暂无官网链接，可搜索企业名投递"
                className="flex items-center gap-1 rounded-md border border-dashed border-border bg-card px-2 py-1 text-[11.5px] text-muted-foreground"
              >
                暂无官网
              </span>
            )}
            {!c.deadlineConfirmedAt && !editing && (
              <button
                onClick={() => onConfirm(c)}
                title="在官网确认截止时间无误后点此标记"
                className="rounded-md border border-border/80 bg-card px-2 py-1 text-[11.5px] text-muted-foreground transition-colors hover:border-emerald-500/50 hover:text-emerald-700 dark:hover:text-emerald-300"
              >
                我已核对
              </button>
            )}
            {!editing && (
              <button
                onClick={() => {
                  setEditDate(ddl.day)
                  setEditing(true)
                }}
                title="在官网查到的日期与此不同？就地修正"
                aria-label={`修正「${c.name}」的截止日期`}
                className="flex size-6.5 items-center justify-center rounded-md border border-border/80 bg-card text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
              >
                <PencilLine className="size-3" strokeWidth={1.7} />
              </button>
            )}
          </div>
        </div>
      </div>
    </li>
  )
}

/** 投递日历视图：月历 + 当日名单 + 七日倒计时 + 可信度闭环 */
export function DeadlineView({
  data,
  loading,
  month,
  onMonth,
  today,
  onDetail,
  onConfirm,
  onCorrect,
  onGoDirectory,
}: {
  data: DeadlinesResponse | null
  loading: boolean
  month: string
  onMonth: (m: string) => void
  today: string
  onDetail: (c: Company) => void
  onConfirm: (c: Company) => Promise<void>
  onCorrect: (c: Company, date: string) => Promise<void>
  onGoDirectory: () => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const counts = data?.counts
  const items = data?.items ?? []

  const byDay = useMemo(() => {
    const map = new Map<string, Company[]>()
    for (const c of items) {
      const ddl = companyDeadline(c.deadline)
      if (!ddl) continue
      const list = map.get(ddl.day) ?? []
      list.push(c)
      map.set(ddl.day, list)
    }
    return map
  }, [items])

  // 默认选中：今天在本月选今天；否则选月内第一个有截止的日子
  const effectiveSelected = useMemo(() => {
    if (selected) return selected
    if (byDay.has(today)) return today
    const first = [...byDay.keys()].sort()[0]
    return first ?? null
  }, [selected, byDay, today])

  const selectedList = effectiveSelected ? (byDay.get(effectiveSelected) ?? []) : []

  // 核对打卡：连续天数（近 30 天日期集合）+ 今天已核对家数（打卡反馈用）
  const streak = confirmStreak(data?.confirmDates ?? [], today)
  const todayChecks = (data?.recentConfirms ?? []).filter((r) => r.at.slice(0, 10) === today).length

  const goDay = (day: string) => {
    if (day.slice(0, 7) !== month) onMonth(day.slice(0, 7))
    setSelected(day)
    window.scrollTo({ top: 0 })
  }

  const grid = buildGrid(month)

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      {/* 页头 */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-foreground/15 pb-8 pt-10 sm:pb-10 sm:pt-14">
        <div>
          <p className="kicker text-[10.5px] text-[color:var(--amber)]">Deadline Calendar</p>
          <h1 className="font-display mt-2.5 flex items-baseline gap-3 text-[30px] font-bold tracking-wide sm:text-[36px]">
            <span aria-hidden className="section-no text-[28px] font-semibold sm:text-[32px]">06</span>
            投递日历
          </h1>
          <p className="mt-2.5 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
            全季企业的网申截止按日排布，先截止的先办。机器只做两件事：探测官网是否可达、把公开情报按来源分层——截止日期本身没有任何渠道能保证准确，所以每天给你三 家最该核对的，点开官网看一眼、打个卡，日历才会一点点变成你自己的可信日历。
          </p>
        </div>
      </div>

      {/* 氛围横幅：夜空星轨——每一个截止都值得提前看见 */}
      <ViewBanner
        src="/images/banner-night.jpg"
        alt="夜空星轨氛围横幅"
        title="每一个截止，都提前看见"
        note={
          counts && counts.urgent3 + counts.urgent7 > 0
            ? `未来 7 天 · ${counts.urgent3 + counts.urgent7} 家截止（3 天内 ${counts.urgent3} 家）`
            : "未来 7 天 · 暂无到期截止"
        }
        tone="dark"
        priority
        className="mt-6 h-40 sm:h-44"
      />

      {/* 加载骨架 */}
      {loading && !data ? (
        <div className="mt-5 h-[430px] animate-pulse rounded-lg bg-secondary/60" />
      ) : (
        <>
          {/* 概览 + 数据可信度说明 */}
          {counts && (
            <section
              aria-label="截止概览"
              className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-3"
            >
              <h2 className="font-display shrink-0 text-[15px] font-bold tracking-wide text-foreground">截止概览</h2>
              <span aria-hidden className="h-px min-w-5 flex-1 bg-border/70" />
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] tabular-nums text-muted-foreground">
                <span>
                  本月截止 <b className="text-[13px] font-semibold text-foreground">{counts.inMonth}</b> 家
                </span>
                <span>
                  3 天内 <b className="text-[13px] font-semibold text-[color:var(--crimson-deep)]">{counts.urgent3}</b> 家
                </span>
                <span>
                  7 天内 <b className="text-[13px] font-semibold text-foreground">{counts.urgent7}</b> 家
                </span>
                <span>
                  已核对 <b className="text-[13px] font-semibold text-emerald-700 dark:text-emerald-300">{counts.confirmed}</b> 家
                </span>
                <span className="hidden sm:inline">
                  缺情报 <b className="text-[13px] font-semibold text-foreground">{counts.noDlCount}</b> 家
                </span>
              </span>
              {data?.verify && (
                <p className="w-full border-t border-border/50 pt-2 text-[11.5px] leading-relaxed text-muted-foreground">
                  官网自动探测：可达{" "}
                  <b className="font-semibold text-emerald-700 dark:text-emerald-300">{data.verify.ok}</b> · 反爬/跳转{" "}
                  <b className="font-semibold text-foreground">{data.verify.soft}</b> · 不可达{" "}
                  <b className="font-semibold text-[color:var(--crimson-deep)]">{data.verify.fail}</b> · 未探测{" "}
                  <b className="font-semibold text-foreground">{data.verify.unchecked}</b>
                  <span className="ml-1.5 text-muted-foreground/85">
                    ——机器只能确认「官网活着」，截止日期请以官网公告为准
                  </span>
                </p>
              )}
            </section>
          )}

          {/* 今日核对打卡：把「人工核对」变成每天 3 家的微习惯——紧迫的先核，核一家亮一个点 */}
          {data && (
            <section
              aria-label="今日核对"
              className="mt-3 rounded-lg border border-[color:var(--amber)]/30 bg-[color:var(--amber-soft)]/45 px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="font-display flex shrink-0 items-center gap-1.5 text-[15px] font-bold tracking-wide text-foreground">
                  <CalendarCheck className="size-4 text-[color:var(--amber-ink)]" strokeWidth={1.8} />
                  今日核对
                </h2>
                {streak > 0 && (
                  <span
                    title="连续打卡：昨天或今天至少核对过一家，且之前每天不断"
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[color:var(--amber)]/45 bg-card px-2 py-px text-[11px] font-semibold text-[color:var(--amber-ink)]"
                  >
                    <Flame className="size-3" strokeWidth={2} />
                    连续 {streak} 天
                  </span>
                )}
                <span className="text-[11.5px] text-muted-foreground">
                  {todayChecks > 0 ? `今天已核对 ${todayChecks} 家` : "每天三家，官网看一眼、回来打个卡"}
                </span>
                <span aria-hidden className="ml-auto flex items-center gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className={cn(
                        "size-1.5 rounded-full transition-colors",
                        todayChecks > i ? "bg-emerald-500" : "bg-border"
                      )}
                    />
                  ))}
                </span>
              </div>
              {data.reviewQueue.length > 0 ? (
                <ul className="mt-2 flex flex-col">
                  {data.reviewQueue.map((c) => {
                    const ddlDay = companyDeadline(c.deadline)?.day ?? today
                    const d = daysUntil(ddlDay, today)
                    return (
                      <li
                        key={c.id}
                        className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-border/40 px-1 py-1.5 last:border-b-0"
                      >
                        <CompanyAvatar name={c.name} className="size-6 shrink-0 rounded-[6px] text-[11px]" />
                        <button
                          onClick={() => onDetail(c)}
                          className="text-[13px] font-semibold tracking-wide transition-colors hover:text-primary"
                        >
                          {c.name}
                        </button>
                        <span className="text-[11px] tabular-nums text-muted-foreground">{dateLabel(ddlDay)}截止</span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium tabular-nums",
                            d <= 3
                              ? "border-[color:var(--crimson)]/45 bg-[color:var(--crimson-soft)] text-[color:var(--crimson-deep)]"
                              : "border-border bg-card text-muted-foreground"
                          )}
                        >
                          {d <= 0 ? "今天到期" : `剩 ${d} 天`}
                        </span>
                        <span className="ml-auto flex items-center gap-1.5">
                          {c.recruitUrl ? (
                            <a
                              href={c.recruitUrl}
                              target="_blank"
                              rel="noreferrer"
                              title="前往招聘官网核对截止时间"
                              className="flex items-center gap-1 rounded-md border border-primary/30 bg-card px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:border-primary/55 hover:bg-accent"
                            >
                              <ExternalLink className="size-2.5" strokeWidth={1.8} />
                              去官网
                            </a>
                          ) : (
                            <span className="rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground">
                              暂无官网，可搜索确认
                            </span>
                          )}
                          <button
                            onClick={() => onConfirm(c)}
                            title="在官网确认截止时间无误后点此打卡"
                            className="rounded-md border border-emerald-500/40 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-400/40 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                          >
                            已核对
                          </button>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="mt-2 px-1 text-[12.5px] leading-relaxed text-muted-foreground">
                  紧迫清单已清空 ✓ 未核对的家离截止都还宽裕，保持节奏就好
                </p>
              )}
            </section>
          )}

          {/* 月历 */}
          <section aria-label="截止月历" className="mt-4 rounded-lg border border-border bg-card p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 pb-3">
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => onMonth(shiftMonth(month, -1))}
                  aria-label="上一月"
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <ChevronLeft className="size-4" strokeWidth={1.6} />
                </button>
                <button
                  onClick={() => onMonth(shiftMonth(month, 1))}
                  aria-label="下一月"
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <ChevronRight className="size-4" strokeWidth={1.6} />
                </button>
              </div>
              <h2 className="font-display text-[15px] font-semibold tracking-wide tabular-nums">{monthTitle(month)}</h2>
              {month !== today.slice(0, 7) && (
                <button
                  onClick={() => onMonth(today.slice(0, 7))}
                  className="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                >
                  回到本月
                </button>
              )}
              <span className="ml-auto text-[11.5px] tabular-nums text-muted-foreground">
                {items.length > 0 ? `${items.length} 家本月截止` : "本月暂无截止"}
              </span>
            </div>

            <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-border bg-card [&>*:nth-child(7n)]:border-r-0 [&>*:nth-last-child(-n+7)]:border-b-0">
              {WEEKDAY_HEADS.map((h, i) => (
                <div
                  key={h}
                  className={cn(
                    "border-b border-r border-border/60 bg-secondary/40 px-1 py-1.5 text-center text-[10.5px] tracking-wide text-muted-foreground",
                    i >= 5 && "text-muted-foreground/80"
                  )}
                >
                  {h}
                </div>
              ))}
              {grid.map((cell) => {
                const isToday = cell.date === today
                const isSelected = cell.date === effectiveSelected
                const list = byDay.get(cell.date) ?? []
                const dayNum = Number(cell.date.slice(8, 10))
                return (
                  <button
                    key={cell.date}
                    onClick={() => setSelected(cell.date)}
                    aria-pressed={isSelected}
                    aria-label={`${dateLabel(cell.date)}${list.length > 0 ? `，${list.length} 家截止` : "，无截止"}`}
                    className={cn(
                      "flex min-h-[56px] flex-col gap-0.5 border-b border-r border-border/50 p-1.5 text-left align-top transition-colors hover:bg-secondary/40 sm:min-h-[80px]",
                      cell.inMonth ? "" : "opacity-35",
                      isSelected
                        ? "bg-secondary/60 ring-1 ring-inset ring-primary/35"
                        : isToday
                          ? "ring-1 ring-inset ring-primary/20"
                          : ""
                    )}
                  >
                    <span
                      className={cn(
                        "text-[11px] leading-none tabular-nums",
                        cell.dow >= 5 && "text-muted-foreground/75",
                        isToday && "font-semibold text-primary"
                      )}
                    >
                      {dayNum}
                    </span>
                    <span className="hidden flex-col gap-0.5 sm:flex">
                      {list.slice(0, 3).map((c) => {
                        const d = companyDeadline(c.deadline)
                        return (
                          <span
                            key={c.id}
                            className="flex items-center gap-1 rounded-[3px] px-1 py-[3px] transition-colors hover:bg-secondary/70"
                          >
                            <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", urgencyDot(d?.d ?? 99))} />
                            <span className="truncate text-[10.5px] leading-none text-foreground/80">{c.name}</span>
                            {c.deadlineConfirmedAt && (
                              <BadgeCheck aria-hidden className="size-2.5 shrink-0 text-emerald-600 dark:text-emerald-400" strokeWidth={2.2} />
                            )}
                          </span>
                        )
                      })}
                      {list.length > 3 && (
                        <span className="px-1 text-[10px] leading-none tabular-nums text-muted-foreground/70">
                          +{list.length - 3}
                        </span>
                      )}
                    </span>
                    {list.length > 0 && (
                      <span className="rounded-[3px] bg-secondary/70 px-1 py-[2px] text-[10px] leading-none tabular-nums text-foreground/70 sm:hidden">
                        {list.length} 家
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </section>

          {/* 当日名单 + 侧栏 */}
          <div className="mt-5 grid gap-5 lg:grid-cols-12">
            <section aria-label="当日截止名单" className="lg:col-span-8">
              <div className="rounded-lg border border-border bg-card px-4 py-3 sm:px-5">
                <div className="flex items-center gap-3">
                  <h2 className="font-display shrink-0 text-[15px] font-bold tracking-wide text-foreground">
                    {effectiveSelected ? dateLabel(effectiveSelected) : "选一天"}截止
                  </h2>
                  <span aria-hidden className="h-px min-w-5 flex-1 bg-border/70" />
                  <span className="shrink-0 text-[11.5px] font-medium tabular-nums text-muted-foreground">
                    {effectiveSelected && weekdayLabel(effectiveSelected)} · {selectedList.length} 家
                  </span>
                </div>
                {selectedList.length === 0 ? (
                  <p className="px-1 py-6 text-center text-[12.5px] text-muted-foreground">
                    这一天没有截止的企业——点月历其他日期查看
                  </p>
                ) : (
                  <ul className="mt-1.5">
                    {selectedList.map((c) => (
                      <DeadlineRow key={c.id} c={c} onDetail={onDetail} onConfirm={onConfirm} onCorrect={onCorrect} />
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <div className="flex flex-col gap-5 lg:col-span-4">
              {/* 未来 7 天倒计时（跨月） */}
              <section aria-label="未来七天截止" className="rounded-lg border border-border bg-card px-4 py-3">
                <div className="flex items-center gap-3">
                  <h2 className="font-display shrink-0 text-[15px] font-bold tracking-wide text-foreground">未来 7 天</h2>
                  <span aria-hidden className="h-px min-w-5 flex-1 bg-border/70" />
                  <CalendarClock aria-hidden className="size-4 shrink-0 text-[color:var(--amber-ink)]" strokeWidth={1.6} />
                </div>
                {data && data.upcoming.length > 0 ? (
                  <ul className="mt-1.5">
                    {data.upcoming.map((c) => {
                      const d = companyDeadline(c.deadline)
                      if (!d) return null
                      return (
                        <li key={c.id}>
                          <button
                            onClick={() => goDay(d.day)}
                            className="group flex w-full items-center gap-2.5 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-secondary/50"
                          >
                            <span className="w-14 shrink-0 text-[11px] leading-tight tabular-nums text-muted-foreground">
                              {dateLabel(d.day).replace("月", "/")}
                              <span className="block text-[10px] text-muted-foreground/80">{weekdayLabel(d.day).slice(-2)}</span>
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{c.name}</span>
                            <span
                              className={cn(
                                "shrink-0 rounded-full border px-1.5 text-[10.5px] leading-4 font-medium tabular-nums",
                                d.d <= 3
                                  ? "border-[color:var(--crimson)]/45 bg-[color:var(--crimson-soft)] text-[color:var(--crimson-deep)]"
                                  : "border-primary/25 bg-accent text-accent-foreground/90"
                              )}
                            >
                              {d.d === 0 ? "今天" : `${d.d} 天`}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="px-1 py-3 text-[12px] text-muted-foreground">未来 7 天没有截止，从容准备</p>
                )}
              </section>

              {/* 缺截止情报：本季无截止的公司不进月历，集中在这里防漏看 */}
              {data && data.starredNoDl.length > 0 && (
                <section aria-label="缺截止情报" className="rounded-lg border border-dashed border-border bg-card/60 px-4 py-3">
                  <div className="flex items-baseline gap-2">
                    <h2 className="font-display text-[15px] font-bold tracking-wide text-foreground">缺截止情报</h2>
                    <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                      本季共 {data.counts.noDlCount} 家暂无
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                    月历只排有截止情报的公司，缺的不代表没在招——星标企业列在下面，点去搜官网确认
                  </p>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {data.starredNoDl.map((s) => (
                      <li key={s.id}>
                        <a
                          href={s.recruitUrl || `https://cn.bing.com/search?q=${encodeURIComponent(`${s.name} 校园招聘 网申截止`)}`}
                          target="_blank"
                          rel="noreferrer"
                          title={s.recruitUrl ? `去 ${s.name} 官网查截止时间` : `搜索 ${s.name} 的网申截止`}
                          className="flex items-center gap-1 rounded-full border border-border bg-card px-2 py-1 text-[11.5px] text-foreground/80 transition-colors hover:border-primary/40 hover:text-primary"
                        >
                          {s.name}
                          <ExternalLink className="size-3" strokeWidth={1.6} />
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* 可信度说明：来源分层 + 核对闭环 */}
              <section aria-label="数据可信度说明" className="rounded-lg border border-border bg-card px-4 py-3">
                <h2 className="font-display text-[15px] font-bold tracking-wide text-foreground">数据可信度</h2>
                <ul className="mt-1.5 flex flex-col gap-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                  <li className="flex items-center gap-1.5">
                    <span className={cn("shrink-0 rounded-full border px-1.5 py-px text-[10.5px]", sourceTier({ sourceType: "官网", sourceName: "" } as Company).cls)}>
                      官网来源
                    </span>
                    企业招聘官网直采，可信度最高
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className={cn("shrink-0 rounded-full border px-1.5 py-px text-[10.5px]", sourceTier({ sourceType: "招聘平台", sourceName: "" } as Company).cls)}>
                      平台转载
                    </span>
                    实习僧 / 牛客等转载，留意转发时效
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="shrink-0 rounded-full border border-border bg-secondary/70 px-1.5 py-px text-[10.5px] text-muted-foreground">转发渠道</span>
                    公众号 / 高校就业网转发，务必核对
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-50 px-1.5 py-px text-[10.5px] font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                      <BadgeCheck className="size-3" strokeWidth={2} />
                      已核对
                    </span>
                    你在官网亲自确认过的时间戳
                  </li>
                </ul>
                <p className="mt-2 border-t border-border/50 pt-2 text-[11px] leading-relaxed text-muted-foreground">
                  共 {counts?.withDeadline ?? 0} 家有截止情报，{counts?.noDlCount ?? 0} 家暂缺；
                  所有时间以企业官网最终公告为准。
                </p>
              </section>
            </div>
          </div>

          {/* 本月无截止的空态 */}
          {!loading && items.length === 0 && (
            <div className="mt-5 flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-14 text-center">
              <SearchX className="size-8 text-muted-foreground/60" strokeWidth={1.2} />
              <p className="font-display text-[15.5px] text-foreground/80">{monthTitle(month)}没有截止记录</p>
              <p className="max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">
                换个月份看看；也可以到企业名录按「截止最近」排序，检查情报覆盖情况
              </p>
              <button
                onClick={onGoDirectory}
                className="mt-1 h-9 rounded-md border border-border bg-card px-4 text-[13px] font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                去企业名录看看
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
