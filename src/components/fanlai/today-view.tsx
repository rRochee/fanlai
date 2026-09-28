"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import { motion } from "framer-motion"
import { BadgeCheck, Check, Copy, DatabaseZap, EyeOff, Share2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { dateLabel, weekdayLabel } from "@/lib/date"
import { useCountUp } from "@/hooks/use-count-up"
import type { BatchInfo, Company, Season, Stats } from "@/lib/types"
import { CompanyRow } from "./company-row"
import { Bowl } from "./bowl"
import { SectionHead } from "./section-head"
import { StoryScroll } from "./story-scroll"
import { QuoteCard } from "./quote-card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const SEASON_DESC: Record<Season, string> = {
  秋招: "秋招",
  春招: "春招",
  社招: "社招",
}

export function TodayView({
  stats,
  batches,
  selectedDay,
  onSelectDay,
  companies,
  loading,
  season,
  onDetail,
  onApply,
  onStar,
  onSync,
  syncing,
  syncInfo,
  onReview,
  reviewing,
  onOpenSyncPanel,
}: {
  stats: Stats | null
  batches: BatchInfo[] | null
  selectedDay: string
  onSelectDay: (d: string) => void
  companies: Company[] | null
  loading: boolean
  season: Season
  onDetail: (c: Company) => void
  onApply: (c: Company) => void
  onStar: (c: Company) => void
  onSync: () => void
  syncing: boolean
  syncInfo: string | null
  onReview: (action: "confirm" | "ignore") => void
  reviewing: boolean
  onOpenSyncPanel: () => void
}) {
  const isToday = selectedDay === stats?.today
  const seasonWord = SEASON_DESC[season]
  const pendingItems = (companies ?? []).filter((c) => !c.verified && !c.hidden)
  const pendingCount = pendingItems.length
  // 杂志刊头：主标随饭锅状态换气，副标交代状态；Loading 保持中性
  const dayCount = companies?.length ?? 0
  const heroTitle = !isToday
    ? dateLabel(selectedDay)
    : loading
      ? `今日${seasonWord}名录`
      : dayCount > 0
        ? `今日开饭`
        : `饭在路上`
  const heroSub = !isToday
    ? `回看这天送出的 ${dayCount} 家${seasonWord}企业`
    : loading
      ? `正在摆盘，马上开饭`
      : dayCount > 0
        ? `${seasonWord}名录已送达 · 共 ${dayCount} 家上新，先看企业，再挑岗位`
        : `主厨每天 8 点后开火；也可以点「同步今日情报」催一下锅`
  // hero 里的饭碗：同步时跟着颠锅，空锅时专注做饭，默认安静冒热气
  const heroBowlMood = syncing ? ("cook" as const) : isToday && !loading && dayCount === 0 ? ("cook" as const) : ("idle" as const)
  // 批量审核二次确认：全部确认不可逆，全部忽略需告知找回入口
  const [reviewAction, setReviewAction] = useState<"confirm" | "ignore" | null>(null)

  // 分享文案：把当日批次变成可转发的纯文字摘要（复制给同学 / 群里）
  const [shareOpen, setShareOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const shareText = useMemo(() => {
    const list = companies ?? []
    if (list.length === 0) return ""
    const lines = list.map((c) => {
      const meta = [c.industry, c.city && c.city !== "待核" ? c.city : ""].filter(Boolean).join(" · ")
      const pos = (c.positions || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 3).join(" / ")
      return `${c.name}${meta ? `（${meta}）` : ""}${pos ? `：${pos}` : ""}`
    })
    return [
      `【饭来 · ${dateLabel(selectedDay)} ${seasonWord}名录】今日送达 ${list.length} 家：`,
      ...lines.map((l) => `· ${l}`),
      `先看企业，再挑岗位，完整简介与招聘官网见饭来。`,
    ].join("\n")
  }, [companies, selectedDay, seasonWord])

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(shareText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 剪贴板不可用时降级：选中全部文本让用户手动复制
      ;(document.getElementById("fanlai-share-text") as HTMLTextAreaElement | null)?.select()
    }
  }

  // 最近一次情报同步（自动 / 手动），仅今日视图且为当天时展示
  const lastSync = stats?.lastSync ?? null
  const lastSyncText = (() => {
    if (!lastSync) return null
    const at = new Date(lastSync.at)
    if (Number.isNaN(at.getTime())) return null
    const time = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(at)
    const parts: string[] = []
    if (lastSync.added > 0) parts.push(`新收录 ${lastSync.added} 家`)
    if (lastSync.refreshed > 0) parts.push(`重新送达 ${lastSync.refreshed} 家`)
    const sourceWord = lastSync.source === "auto" ? "自动同步" : "手动同步"
    return parts.length > 0 ? `今日 ${time} ${sourceWord} · ${parts.join(" / ")}` : `今日 ${time} ${sourceWord} · 暂无新增`
  })()

  return (
    <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      {/* Hero · 杂志刊头 */}
      <section className="relative grid items-center gap-8 pb-10 pt-5 sm:pb-14 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-7">
          {/* 刊头条：双规线之间的期号信息，每天一期的「名录日报」 */}
          <div className="rule-double flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1.5">
            <span className="kicker text-[11px] font-semibold text-foreground/85">FanLai Daily · {seasonWord}号</span>
            <span className="kicker text-[11px] text-foreground/80 tabular-nums">
              VOL.{stats?.total ?? "—"} · {dateLabel(selectedDay)} {weekdayLabel(selectedDay)}
            </span>
            <span className="kicker hidden text-[11px] text-muted-foreground/90 md:inline">FIND A JOB · EAT WELL</span>
          </div>

          {/* 超大 masthead 主标 + 声部色贴纸 */}
          <div className="mt-7 flex flex-wrap items-start gap-x-4 gap-y-2">
            <h1 className="masthead font-display text-[50px] font-black leading-[1.04] sm:text-[68px]">
              {heroTitle}
            </h1>
            {syncing ? (
              <span
                role="status"
                className="sticker-tag mt-1.5 inline-flex items-center gap-1.5 rounded-[2px] bg-primary px-2 py-1 font-display text-[10.5px] font-bold tracking-wide text-primary-foreground shadow-hard-sm"
              >
                <Bowl mood="cook" size={13} />
                {syncInfo ? syncInfo.split(" · ").slice(0, 2).join(" · ") : "热饭中"}
              </span>
            ) : (
              isToday &&
              !loading &&
              dayCount > 0 && (
                <span
                className="sticker-tag mt-1.5 inline-flex items-center gap-1.5 rounded-[2px] bg-[color:var(--crimson)] px-2 py-1 font-display text-[10.5px] font-bold tracking-wide text-white shadow-hard-sm"
              >
                  今日上新 +{dayCount}
                </span>
              )
            )}
            <Bowl mood={heroBowlMood} size={38} className="mt-2 hidden sm:block" />
          </div>
          <p className="font-display mt-3 text-[16px] leading-relaxed text-foreground/85 sm:text-[18px]">{heroSub}</p>

          <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
            <span className="font-display font-bold text-foreground">工作到我碗里来。</span>
            饭来每天为你整理当日新放出{seasonWord}的企业：不限规模、行业与轮次，全量收录，
            每一家都附清晰的简介与官网入口——你的优先赛道已置顶，其余各行各业一并奉上。
          </p>

          {/* 指标列：杂志数字风（大号衬线数字 + 底部小标） */}
          <div className="mt-8 flex flex-wrap items-end gap-x-8 gap-y-4">
            <Metric label="今日新增" value={stats?.todayCount ?? null} prefix="+" accent pulse={!!stats && stats.todayCount > 0} />
            <Metric label="累计收录" value={stats?.total ?? null} />
            <Metric label="已投递" value={stats?.appliedTotal ?? null} />
            <Metric label="面试中" value={stats?.byStatus["面试中"] ?? null} />
            {(stats?.upcomingDeadline ?? 0) > 0 && <Metric label="7日内节点" value={stats!.upcomingDeadline} accent />}
          </div>
          {isToday && lastSyncText && (
            <p className="mt-4 flex items-center gap-1.5 text-[12.5px] tabular-nums text-muted-foreground">
              <span aria-hidden className="size-1 rounded-full bg-primary/60" />
              {lastSyncText}
            </p>
          )}
          <button
            onClick={onOpenSyncPanel}
            className="mt-2.5 flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-[color:var(--persimmon-ink)]"
            title="查看更新机制、每轮检索报告与遗漏兑底入口"
          >
            <DatabaseZap className="size-3.5" strokeWidth={1.6} />
            数据源与更新机制
            <span aria-hidden className="text-muted-foreground/75">›</span>
          </button>
        </div>

        <div className="relative lg:col-span-5">
          <div className="relative mx-auto max-w-md rounded-xl border border-border/80 bg-card p-1.5 lg:max-w-none">
            <div className="cover-img relative aspect-[2/1] overflow-hidden rounded-[10px]">
              {/* 广阔风景照：草原与远山，晴日开饭的开阔感；暗色由 art-img 压亮度 */}
              <Image
                src="/images/hero-scenery.jpg"
                alt="饭来主视觉：开阔草原与远山，晴日开饭"
                fill
                priority
                sizes="(max-width: 1024px) 90vw, 480px"
                className="art-img object-cover"
              />
            </div>
            <p className="px-1 pb-0.5 pt-2 text-center font-display text-[11px] tracking-[0.2em] text-muted-foreground">
              每日准时送达
            </p>
          </div>
        </div>
      </section>

      {/* 批次轴 */}
      <section aria-label="近期批次" className="border-y border-border/70 py-3">
        {batches && batches.length === 0 ? (
          <p className="px-1 py-1.5 text-[11.5px] text-muted-foreground/80">批次正在整理，稍后在这里按日排列</p>
        ) : (
          <div className="fade-x no-scrollbar -mx-3 flex items-center gap-1.5 overflow-x-auto px-3">
            {batches?.map((b) => {
              const selected = b.date === selectedDay
              const empty = b.count === 0
              return (
                <button
                  key={b.date}
                  onClick={() => onSelectDay(b.date)}
                  aria-pressed={selected}
                  aria-label={`${dateLabel(b.date)}${b.isToday ? "（今日）" : ""}，${
                    empty ? "无放出企业" : `${b.count} 家企业`
                  }`}
                  className={cn(
                    "relative flex shrink-0 flex-col items-center gap-1 rounded-md px-3 py-1.5 transition-colors",
                    selected
                      ? "bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(30,75,58,0.28)]"
                      : "text-foreground/80 hover:bg-secondary/70 hover:text-foreground"
                  )}
                >
                  <motion.span
                    className={cn("text-[13px] font-semibold leading-none", !selected && empty && "opacity-55")}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.94 }}
                  >
                    {b.isToday ? "今日" : dateLabel(b.date).replace("月", "/").replace("日", "")}
                  </motion.span>
                  <span
                    className={cn(
                      "text-[11px] font-medium leading-none tabular-nums",
                      selected ? "text-primary-foreground/85" : "text-muted-foreground"
                    )}
                  >
                    {empty ? "—" : `${b.count} 家`}
                  </span>
                  {!selected && b.isToday && (
                    <span aria-hidden className="absolute right-1 top-1 size-1 rounded-full bg-primary/70" />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* 当日名录 */}
      <section aria-label={`${dateLabel(selectedDay)}放出的企业`} className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <SectionHead
            no="05"
            title={isToday ? "今日送达" : dateLabel(selectedDay)}
            en="TODAY'S SERVE"
            className="min-w-0 flex-1"
            right={
              <span className="text-[12.5px] font-medium tabular-nums text-foreground/80">
                共 {companies?.length ?? 0} 家
              </span>
            }
          />
          <div className="flex shrink-0 items-center gap-3">
            <button
              onClick={onSync}
              disabled={syncing}
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[12.5px] font-medium text-foreground/80 transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-60"
              title={syncing ? syncInfo ?? "热饭中" : `联网搜索最新${seasonWord}情报，AI 提炼后入库存为「待核」条目`}
            >
              <Bowl mood={syncing ? "cook" : "idle"} size={16} />
              {syncing ? (syncInfo ? syncInfo.split(" · ").slice(0, 2).join(" · ") : "热饭中…") : "同步今日情报"}
            </button>
            {(companies?.length ?? 0) > 0 && (
              <button
                onClick={() => {
                  setCopied(false)
                  setShareOpen(true)
                }}
                className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[12.5px] font-medium text-foreground/80 transition-colors hover:border-foreground/30 hover:text-foreground"
                title="把当日名录复制成纯文字摘要，转发给同学"
              >
                <Share2 className="size-3.5" strokeWidth={1.6} />
                复制分享文案
              </button>
            )}
            <p className="hidden text-[12px] text-muted-foreground sm:block">
              点击行查看完整简介，或直接前往官网投递
            </p>
          </div>
        </div>

        {/* 待核情报工具条：今日批次内存在 AI 待核条目时展示，支持批量确认 / 忽略 */}
        {isToday && pendingCount > 0 && (
          <div
            role="toolbar"
            aria-label="待核情报批量操作"
            className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-[color:var(--crimson)]/30 bg-[color:var(--crimson-soft)]/60 px-3.5 py-2.5"
          >
            <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-[color:var(--crimson-deep)]">
              <span className="font-medium tabular-nums">{pendingCount} 条</span> AI 情报待人工核实
              <span className="ml-2 hidden text-[12px] opacity-90 sm:inline">逐条点开核实，或批量处理</span>
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => setReviewAction("confirm")}
                disabled={reviewing}
                className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-card px-2.5 py-1 text-[12px] font-medium text-primary transition-colors hover:border-primary/55 hover:bg-accent disabled:opacity-60"
                title="把全部待核条目标记为已核目录"
              >
                <BadgeCheck className="size-3.5" strokeWidth={1.6} />
                全部确认
              </button>
              <button
                onClick={() => setReviewAction("ignore")}
                disabled={reviewing}
                className="flex items-center gap-1.5 rounded-md border border-border/80 bg-card px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-60"
                title="忽略全部待核条目（可在名录「含已忽略」中找回）"
              >
                <EyeOff className="size-3.5" strokeWidth={1.6} />
                全部忽略
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 rounded-lg border border-border bg-card">
          {loading && !companies ? (
            <div className="p-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-5">
                  <Skeleton className="size-10 rounded-md" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : companies && companies.length > 0 ? (
            companies.map((c, i) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 10) * 0.04, duration: 0.35, ease: "easeOut" }}
              >
                <CompanyRow company={c} onDetail={onDetail} onApply={onApply} onStar={onStar} />
              </motion.div>
            ))
          ) : (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <Bowl mood={isToday ? "cook" : "sad"} size={56} />
              {isToday ? (
                <>
                  <p className="font-display text-[16px] text-foreground/80">今日的饭还在路上</p>
                  <p className="max-w-sm text-[13px] leading-relaxed text-muted-foreground">
                    主厨每天早上 8 点后开火；也可以点上方「同步今日情报」催一下锅，或在批次轴回看昨天的名录
                  </p>
                </>
              ) : (
                <>
                  <p className="font-display text-[16px] text-foreground/80">这一天没上新菜</p>
                  <p className="max-w-xs text-[13px] leading-relaxed text-muted-foreground">
                    名录每日更新，换个日期看看，或到企业名录里翻阅当季全量名录
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </section>

      {/* 今日一言 · 古籍哲理：投递之外，稳住心神（Task 25-f） */}
      <QuoteCard today={stats?.today ?? selectedDay} className="mt-8" />

      {/* 三步开饭 · 滚动叙事：下滑 30 秒看懂饭来怎么用、有什么用 */}
      <StoryScroll />

      {/* 分享文案预览：编辑化弹窗，一键复制 / 手动选段 */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="rounded-lg p-0 sm:max-w-[520px]">
          <DialogHeader className="border-b border-border/70 px-5 pb-3.5 pt-5">
            <DialogTitle className="font-display text-[15px] tracking-wide">分享当日名录</DialogTitle>
            <DialogDescription className="text-[12px] leading-relaxed">
              已生成纯文字摘要（{shareText.length} 字），复制后可直接转发到群聊或朋友圈
            </DialogDescription>
          </DialogHeader>
          <div className="px-5 pb-5 pt-4">
            <textarea
              id="fanlai-share-text"
              readOnly
              value={shareText}
              rows={12}
              aria-label="分享文案内容"
              className="scroll-thin w-full resize-none rounded-md border border-border/80 bg-secondary/40 p-3 font-mono text-[11.5px] leading-[1.85] text-foreground/85 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <div className="mt-3 flex items-center justify-between">
              <p className="text-[10.5px] text-muted-foreground/80">
                每家含行业与城市，岗位方向最多展示 3 个，可手动删减后再发
              </p>
              <button
                onClick={copyShare}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-md border px-3.5 py-1.5 text-[12px] transition-colors",
                  copied
                    ? "border-primary/40 bg-accent text-primary"
                    : "border-border bg-card text-foreground hover:border-primary/40 hover:text-primary"
                )}
              >
                {copied ? <Check className="size-3.5" strokeWidth={1.8} /> : <Copy className="size-3.5" strokeWidth={1.6} />}
                {copied ? "已复制" : "复制全文"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 批量审核二次确认：全部确认不可逆；全部忽略可从名录找回 */}
      <AlertDialog open={reviewAction !== null} onOpenChange={(open) => !open && setReviewAction(null)}>
        <AlertDialogContent className="rounded-lg sm:max-w-[420px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-base tracking-wide">
              {reviewAction === "confirm" ? `确认收录全部 ${pendingCount} 条待核情报？` : `忽略全部 ${pendingCount} 条待核情报？`}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[12.5px] leading-relaxed">
              {reviewAction === "confirm" ? (
                <>
                  确认后这些企业将正式进入已核目录，此操作<span className="text-foreground">不可撤销</span>。
                  建议先逐条点开核实简介与来源，再批量确认。
                </>
              ) : (
                <>
                  被忽略的条目将从今日名录与企业名录隐藏，之后可在名录勾选
                  <span className="text-foreground">「含已忽略」</span>随时找回，不会丢失数据。
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-md text-[13px]">先不处理</AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                "rounded-md text-[13px]",
                reviewAction === "confirm"
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "border border-border bg-card text-foreground hover:bg-secondary"
              )}
              onClick={() => {
                if (reviewAction) onReview(reviewAction)
                setReviewAction(null)
              }}
            >
              {reviewAction === "confirm" ? "全部确认收录" : "全部忽略"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function Metric({
  label,
  value,
  prefix,
  accent,
  pulse,
}: {
  label: string
  value: number | null
  prefix?: string
  accent?: boolean
  pulse?: boolean
}) {
  // 数字滚动：数据到位/变化时平滑追赶，避免跳变（reduced-motion 下直接取目标值）
  const shown = useCountUp(value ?? 0)
  return (
    <div className="flex flex-col gap-1 border-l border-foreground/15 pl-3 first:border-l-0 first:pl-0">
      <span
        className={cn(
          "font-display text-[34px] font-bold leading-none tabular-nums tracking-tight sm:text-[40px]",
          accent && "text-[color:var(--crimson-deep)] dark:text-[color:var(--crimson)]"
        )}
      >
        {value === null ? "—" : `${prefix ?? ""}${shown}`}
      </span>
      <span className="flex items-center gap-1.5 text-[12px] font-semibold leading-none tracking-wide text-foreground/75">
        {pulse && (
          <span aria-hidden className="relative flex size-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--crimson)]/60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-[color:var(--crimson)]" />
          </span>
        )}
        {label}
      </span>
    </div>
  )
}
