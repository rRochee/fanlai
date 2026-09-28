"use client"

import { useMemo } from "react"
import { Compass, TrendingUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { dateLabel, daysUntil, shiftDateStr, toShanghaiDateStr } from "@/lib/date"
import { Button } from "@/components/ui/button"
import { STATUS_DOT, type ApplicationRecord } from "@/lib/types"
import { ViewBanner } from "./view-banner"
import { VoiceWall } from "./voice-wall"
import { QuoteCard } from "./quote-card"

/**
 * 求职洞察：投递漏斗 / 行业分布 / 投递节奏 / 周对比 / 渠道分布 / 关键数字。
 * 全部由前端从投递记录聚合（含企业 season 过滤），零额外请求。
 * 图表用原生 div 条形实现——与名录的编辑化设计语言一致，不引入图表库配色。
 */

const FUNNEL_STAGES = ["意向中", "已投递", "笔试中", "面试中", "Offer"] as const

/** 近 N 天（含今天）的上海日期序列，最早在前 */
function lastNDays(n: number, today: string): string[] {
  const out: string[] = []
  const base = new Date(`${today}T00:00:00+08:00`).getTime()
  for (let i = n - 1; i >= 0; i--) {
    out.push(toShanghaiDateStr(new Date(base - i * 86400000)))
  }
  return out
}

/** 该日期所在周的周一（上海时区，周一为一周起点） */
function mondayOf(dateStr: string): string {
  const dow = (new Date(`${dateStr}T12:00:00+08:00`).getDay() + 6) % 7
  return shiftDateStr(dateStr, -dow)
}

export function InsightsView({
  applications,
  loading,
  season,
  today,
  starredPendingCount,
  onGoDirectory,
}: {
  applications: ApplicationRecord[] | null
  loading: boolean
  season: string
  today: string
  starredPendingCount: number
  onGoDirectory: () => void
}) {
  // 当季记录（跨季数据不混入，避免春招复盘被秋招数字稀释）
  const scoped = useMemo(
    () => (applications ?? []).filter((a) => a.company?.season === season),
    [applications, season]
  )

  const byStatus = useMemo(
    () =>
      scoped.reduce<Record<string, number>>((acc, a) => {
        acc[a.status] = (acc[a.status] ?? 0) + 1
        return acc
      }, {}),
    [scoped]
  )

  const total = scoped.length
  const offered = byStatus["Offer"] ?? 0
  const interviewing = (byStatus["面试中"] ?? 0) + (byStatus["笔试中"] ?? 0)
  const active = total - offered - (byStatus["暂告段落"] ?? 0)
  const applied = byStatus["已投递"] ?? 0
  // 面试转化率：进入笔试及之后的记录 / 已投递及之后的记录（意向中不算投递行为）
  const enteredPipeline = applied + interviewing + offered
  const interviewRate = enteredPipeline > 0 ? Math.round(((interviewing + offered) / enteredPipeline) * 100) : null

  const maxStage = Math.max(1, ...FUNNEL_STAGES.map((s) => byStatus[s] ?? 0))
  const paused = byStatus["暂告段落"] ?? 0

  const industries = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of scoped) {
      const k = a.company?.industry ?? "未知"
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    const sorted = [...m.entries()].sort((x, y) => y[1] - x[1])
    const top = sorted.slice(0, 6)
    const rest = sorted.slice(6).reduce((s, e) => s + e[1], 0)
    return { top, restCount: rest, totalBuckets: sorted.length }
  }, [scoped])
  const maxIndustry = Math.max(1, ...industries.top.map(([, n]) => n))

  const companiesTouched = useMemo(() => new Set(scoped.map((a) => a.companyId)).size, [scoped])

  const rhythmDays = useMemo(() => lastNDays(14, today), [today])
  const rhythmData = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of scoped) {
      const d = toShanghaiDateStr(a.appliedAt)
      m.set(d, (m.get(d) ?? 0) + 1)
    }
    return rhythmDays.map((d) => ({ day: d, count: m.get(d) ?? 0 }))
  }, [scoped, rhythmDays])
  const maxRhythm = Math.max(1, ...rhythmData.map((r) => r.count))
  const rhythmHasData = rhythmData.some((r) => r.count > 0)

  // 周对比：本周（周一起）vs 上周新增投递量
  const weekCompare = useMemo(() => {
    const thisMonday = mondayOf(today)
    const lastMonday = shiftDateStr(thisMonday, -7)
    let thisWeek = 0
    let lastWeek = 0
    for (const a of scoped) {
      const d = toShanghaiDateStr(a.appliedAt)
      if (d >= thisMonday) thisWeek++
      else if (d >= lastMonday) lastWeek++
    }
    // 本周进行到第几天（跨月不能直接用日号相减，用日历日差：周一为第 1 天）
    return { thisWeek, lastWeek, daysIn: daysUntil(today, thisMonday) + 1 }
  }, [scoped, today])

  // 渠道分布：按投递记录的渠道字段聚合（未填写的归「未注明」）
  const channels = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of scoped) {
      const k = a.channel?.trim() || "未注明"
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    const sorted = [...m.entries()].sort((x, y) => y[1] - x[1])
    const top = sorted.slice(0, 5)
    const rest = sorted.slice(5).reduce((s, e) => s + e[1], 0)
    return { top, restCount: rest, totalBuckets: sorted.length }
  }, [scoped])
  const maxChannel = Math.max(1, ...channels.top.map(([, n]) => n))
  const maxWeek = Math.max(1, weekCompare.thisWeek, weekCompare.lastWeek)

  const summaryCards = [
    { label: "投递记录", value: total, hint: `${companiesTouched} 家企业` },
    { label: "进行中", value: active, hint: "Offer 与暂告段落之外" },
    { label: "笔试·面试", value: interviewing, hint: "正在流程中" },
    { label: "Offer", value: offered, hint: interviewRate === null ? "尚无转化数据" : `面试转化率约 ${interviewRate}%` },
    { label: "星标待投", value: starredPendingCount, hint: "收藏了但还没记录" },
  ]

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      {/* 墨蓝数据故事头：洞察的性格页——把投递记录读成一个有图表的故事 */}
      <div className="pt-8 sm:pt-12">
        <ViewBanner
          src="/images/banner-night.jpg"
          alt="墨蓝夜空与极光下的数据故事头"
          as="h1"
          kicker="04 · INSIGHTS"
          title={`${season}仪表盘`}
          note="漏斗、行业与节奏——这一季的努力，都收进这几张图里。"
          tone="navy"
          priority
          className="h-44 sm:h-56"
        />
      </div>

      {loading && applications === null ? (
        <div className="space-y-3">
          <div className="h-20 animate-pulse rounded-lg bg-secondary/60" />
          <div className="h-48 animate-pulse rounded-lg bg-secondary/60" />
        </div>
      ) : total === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
          <Compass className="size-8 text-muted-foreground/70" strokeWidth={1.2} />
          <p className="font-display text-[15px] text-foreground/70">这一季还没有投递记录</p>
          <p className="max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">
            记下第一笔投递后，这里会长出你的漏斗、行业分布与节奏图
          </p>
          <Button variant="outline" className="mt-1 h-9 rounded-md text-[13px]" onClick={onGoDirectory}>
            去企业名录逛逛
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* 关键数字：hairline 竖线分隔的编辑风数字带 */}
          <section
            aria-label="关键数字"
            className="grid grid-cols-2 gap-y-5 rounded-lg border border-border bg-card px-5 py-5 sm:grid-cols-3 lg:grid-cols-5 lg:gap-y-0 lg:divide-x lg:divide-border/60"
          >
            {summaryCards.map((c, i) => (
              <div
                key={c.label}
                className={cn(
                  "px-1 sm:px-4",
                  i === 0 && "lg:pl-1",
                  i > 0 && "lg:first:pl-4",
                  i === 2 && "max-lg:col-span-2 max-lg:justify-self-start max-lg:pr-0 sm:max-lg:col-span-1",
                  i > 0 && i % 2 === 1 && "max-sm:pl-4 max-sm:border-l max-sm:border-border/60"
                )}
              >
                <div className="font-display text-[26px] font-semibold leading-none tabular-nums tracking-tight">
                  {c.value}
                </div>
                <div className="mt-2 text-[12px] font-medium tracking-wide">{c.label}</div>
                <div className="mt-0.5 text-[10.5px] leading-4 text-muted-foreground/70">{c.hint}</div>
              </div>
            ))}
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* 投递漏斗 */}
            <section aria-label="投递漏斗" className="rounded-lg border border-border bg-card px-4 py-4 sm:px-5">
              <div className="flex items-center gap-3">
                <h2 className="kicker shrink-0 text-[10px] text-muted-foreground">投递漏斗</h2>
                <span aria-hidden className="h-px flex-1 bg-border/60" />
                <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground/70">
                  共 {total} 条记录
                </span>
              </div>
              <div className="mt-3.5 space-y-2.5">
                {FUNNEL_STAGES.map((s) => {
                  const count = byStatus[s] ?? 0
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0
                  return (
                    <div key={s} className="flex items-center gap-3">
                      <span className="flex w-[64px] shrink-0 items-center gap-1.5 text-[12px] text-foreground/80">
                        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[s])} />
                        {s}
                      </span>
                      <div className="h-5 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-secondary/50">
                        <div
                          role="img"
                          aria-label={`${s} ${count} 条，占 ${pct}%`}
                          className={cn("h-full rounded-[3px] transition-[width] duration-500", STATUS_DOT[s])}
                          style={{ width: `${Math.max(count > 0 ? 4 : 0, (count / maxStage) * 100)}%`, opacity: 0.88 }}
                        />
                      </div>
                      <span className="w-14 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">
                        {count} <span className="text-[10.5px] text-muted-foreground/75">· {pct}%</span>
                      </span>
                    </div>
                  )
                })}
                {/* 暂告段落：退出项单独弱化呈现，不进漏斗主轴 */}
                <div className="flex items-center gap-3 border-t border-border/60 pt-2.5">
                  <span className="flex w-[64px] shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground">
                    <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT["暂告段落"])} />
                    暂告段落
                  </span>
                  <div className="h-5 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-secondary/30">
                    <div
                      className="h-full rounded-[3px] bg-stone-300 dark:bg-stone-600"
                      style={{ width: `${Math.max(paused > 0 ? 4 : 0, (paused / maxStage) * 100)}%`, opacity: 0.55 }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground/80">
                    {paused} <span className="text-[10.5px]">{total > 0 ? `· ${Math.round((paused / total) * 100)}%` : ""}</span>
                  </span>
                </div>
              </div>
              <p className="mt-3.5 border-t border-border/60 pt-2.5 text-[11px] leading-relaxed text-muted-foreground/70">
                {enteredPipeline > 0
                  ? `进入流程的 ${enteredPipeline} 条记录里，${interviewing + offered} 条走到了笔试及之后（约 ${interviewRate}%）`
                  : "还没有记录进入投递流程，漏斗会随第一笔投递开始生长"}
              </p>
            </section>

            {/* 行业分布 */}
            <section aria-label="行业分布" className="rounded-lg border border-border bg-card px-4 py-4 sm:px-5">
              <div className="flex items-center gap-3">
                <h2 className="kicker shrink-0 text-[10px] text-muted-foreground">行业分布</h2>
                <span aria-hidden className="h-px flex-1 bg-border/60" />
                <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground/70">
                  {companiesTouched} 家企业
                </span>
              </div>
              <div className="mt-3.5 space-y-2.5">
                {industries.top.map(([name, count], i) => (
                  <div key={name} className="flex items-center gap-3">
                    <span className="w-[92px] shrink-0 truncate text-[12px] text-foreground/80" title={name}>
                      {name}
                    </span>
                    <div className="h-5 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-secondary/50">
                      <div
                        role="img"
                        aria-label={`${name} ${count} 条`}
                        className="h-full rounded-[3px] bg-primary transition-[width] duration-500"
                        style={{ width: `${Math.max(4, (count / maxIndustry) * 100)}%`, opacity: 0.9 - i * 0.12 }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">
                      {count} <span className="text-[10.5px] text-muted-foreground/75">条</span>
                    </span>
                  </div>
                ))}
                {industries.restCount > 0 && (
                  <div className="flex items-center gap-3 border-t border-border/60 pt-2.5">
                    <span className="w-[92px] shrink-0 text-[12px] text-muted-foreground">
                      其他 {industries.totalBuckets - industries.top.length} 个行业
                    </span>
                    <div className="h-5 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-secondary/30">
                      <div
                        className="h-full rounded-[3px] bg-muted-foreground/35"
                        style={{ width: `${Math.max(4, (industries.restCount / maxIndustry) * 100)}%` }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground/80">
                      {industries.restCount} <span className="text-[10.5px]">条</span>
                    </span>
                  </div>
                )}
              </div>
              <p className="mt-3.5 border-t border-border/60 pt-2.5 text-[11px] leading-relaxed text-muted-foreground/70">
                按投递记录计数（同一企业多个岗位会分别计入），反映你的精力分布而非企业广度
              </p>
            </section>
          </div>

          {/* 投递节奏：近 14 天柱状 */}
          <section aria-label="投递节奏" className="rounded-lg border border-border bg-card px-4 py-4 sm:px-5">
            <div className="flex items-center gap-3">
              <h2 className="kicker shrink-0 text-[10px] text-muted-foreground">投递节奏</h2>
              <span aria-hidden className="h-px flex-1 bg-border/60" />
              <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground/70">近 14 天</span>
            </div>
            {/* 柱区：定高容器让 % 高度生效；数值行独立成行避免垂直耦合 */}
            <div className="mt-4 flex h-24 items-end gap-[5px] sm:gap-2">
              {rhythmData.map(({ day, count }) => {
                const isToday = day === today
                const h = count > 0 ? Math.max(5, Math.round((count / maxRhythm) * 100)) : 2
                return (
                  <div key={day} className="flex h-full min-w-0 flex-1 items-end justify-center">
                    <div
                      role="img"
                      aria-label={`${dateLabel(day)}，新增 ${count} 条`}
                      title={`${dateLabel(day)} · ${count} 条`}
                      className={cn(
                        "w-full max-w-[26px] rounded-[3px] transition-[height] duration-500",
                        count > 0
                          ? isToday
                            ? "bg-primary"
                            : "bg-primary/60"
                          : "bg-border/70"
                      )}
                      style={{ height: `${h}%` }}
                    />
                  </div>
                )
              })}
            </div>
            <div className="mt-1 flex gap-[5px] sm:gap-2">
              {rhythmData.map(({ day, count }) => (
                <span
                  key={`${day}-n`}
                  className={cn(
                    "min-w-0 flex-1 text-center text-[10.5px] leading-none tabular-nums",
                    count > 0 ? "text-foreground/70" : "text-transparent"
                  )}
                >
                  {count > 0 ? count : "0"}
                </span>
              ))}
            </div>
            <div className="mt-1.5 flex gap-[5px] sm:gap-2">
              {rhythmData.map(({ day }, i) => (
                <span
                  key={day}
                  className={cn(
                    "min-w-0 flex-1 text-center text-[10px] leading-4 tabular-nums",
                    i % 3 === 1 || i === rhythmData.length - 1 ? "text-muted-foreground/70" : "text-transparent"
                  )}
                >
                  {i === rhythmData.length - 1 ? (
                    <>
                      <span className="sm:hidden">今</span>
                      <span className="hidden sm:inline">今天</span>
                    </>
                  ) : (
                    <>
                      {/* 移动端窄列放不下「8/20」，只显示日号 */}
                      <span className="sm:hidden">{Number(day.slice(8, 10))}</span>
                      <span className="hidden sm:inline">
                        {Number(day.slice(5, 7))}/{Number(day.slice(8, 10))}
                      </span>
                    </>
                  )}
                </span>
              ))}
            </div>
            {!rhythmHasData && (
              <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground/70">
                近 14 天没有新增记录——看看漏斗和行业分布，或去名录里补充下一家
              </p>
            )}
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* 周对比：本周 vs 上周新增投递量 */}
            <section aria-label="本周对比" className="rounded-lg border border-border bg-card px-4 py-4 sm:px-5">
              <div className="flex items-center gap-3">
                <h2 className="kicker shrink-0 text-[10px] text-muted-foreground">本周对比</h2>
                <span aria-hidden className="h-px flex-1 bg-border/60" />
                <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground/70">
                  周一起算 · 第 {weekCompare.daysIn} 天
                </span>
              </div>
              <div className="mt-4 space-y-3.5">
                {(
                  [
                    { label: "本周", count: weekCompare.thisWeek, cls: "bg-primary", pct: "opacity-90" },
                    { label: "上周", count: weekCompare.lastWeek, cls: "bg-muted-foreground/30", pct: "" },
                  ] as const
                ).map((row) => (
                  <div key={row.label} className="flex items-center gap-3">
                    <span className="w-10 shrink-0 text-[12px] text-foreground/80">{row.label}</span>
                    <div className="h-5 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-secondary/50">
                      <div
                        role="img"
                        aria-label={`${row.label}新增投递 ${row.count} 条`}
                        className={cn("h-full rounded-[3px] transition-[width] duration-500", row.cls, row.pct)}
                        style={{ width: `${Math.max(row.count > 0 ? 4 : 0, (row.count / maxWeek) * 100)}%` }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">
                      {row.count} <span className="text-[10.5px] text-muted-foreground/75">条</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-3.5 border-t border-border/60 pt-2.5 text-[11px] leading-relaxed text-muted-foreground/70">
                {weekCompare.thisWeek + weekCompare.lastWeek === 0
                  ? "两周一滴水未投——去名录里找下一家，节奏比完美更重要"
                  : weekCompare.thisWeek > weekCompare.lastWeek
                    ? `比上周同期多 ${weekCompare.thisWeek - weekCompare.lastWeek} 条，保持这个节奏`
                    : weekCompare.thisWeek < weekCompare.lastWeek
                      ? `比上周少 ${weekCompare.lastWeek - weekCompare.thisWeek} 条——检查一下是卡在流程里还是该补新投递了`
                      : "与上周持平，稳定输出"}
              </p>
            </section>

            {/* 渠道分布：投递渠道聚合 */}
            <section aria-label="投递渠道" className="rounded-lg border border-border bg-card px-4 py-4 sm:px-5">
              <div className="flex items-center gap-3">
                <h2 className="kicker shrink-0 text-[10px] text-muted-foreground">投递渠道</h2>
                <span aria-hidden className="h-px flex-1 bg-border/60" />
                <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground/70">
                  {channels.top.length} 类渠道
                </span>
              </div>
              <div className="mt-3.5 space-y-2.5">
                {channels.top.map(([name, count], i) => (
                  <div key={name} className="flex items-center gap-3">
                    <span className="w-[92px] shrink-0 truncate text-[12px] text-foreground/80" title={name}>
                      {name}
                    </span>
                    <div className="h-5 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-secondary/50">
                      <div
                        role="img"
                        aria-label={`渠道「${name}」${count} 条`}
                        className="h-full rounded-[3px] bg-[#6b8f71] transition-[width] duration-500"
                        style={{ width: `${Math.max(4, (count / maxChannel) * 100)}%`, opacity: 0.9 - i * 0.12 }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">
                      {count} <span className="text-[10.5px] text-muted-foreground/75">条</span>
                    </span>
                  </div>
                ))}
                {channels.restCount > 0 && (
                  <div className="flex items-center gap-3 border-t border-border/60 pt-2.5">
                    <span className="w-[92px] shrink-0 text-[12px] text-muted-foreground">
                      其他 {channels.totalBuckets - channels.top.length} 类
                    </span>
                    <div className="h-5 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-secondary/30">
                      <div
                        className="h-full rounded-[3px] bg-muted-foreground/35"
                        style={{ width: `${Math.max(4, (channels.restCount / maxChannel) * 100)}%` }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground/80">
                      {channels.restCount} <span className="text-[10.5px]">条</span>
                    </span>
                  </div>
                )}
              </div>
              <p className="mt-3.5 border-t border-border/60 pt-2.5 text-[11px] leading-relaxed text-muted-foreground/70">
                渠道在记投递时选填（官网 / 内推 / 宣讲会…），未填写的记录归入「未注明」
              </p>
            </section>
          </div>

          <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground/75">
            <TrendingUp className="size-3.5" strokeWidth={1.5} aria-hidden />
            洞察随投递记录实时更新，仅统计{season}数据
          </p>
        </div>
      )}

      {/* 同路人 · 心声墙 + 今日一言：无论有没有记录，情绪与定心都在（Task 25-f/g） */}
      <div className="mt-5 space-y-5">
        <VoiceWall />
        <QuoteCard today={today} />
      </div>
    </div>
  )
}
