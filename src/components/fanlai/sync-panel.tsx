"use client"

import { useEffect, useRef, useState } from "react"
import { useApi } from "@/hooks/use-api"
import { api, type Season } from "@/lib/types"
import type { AuditCandidate, AuditStatus, SyncStatus } from "@/lib/sync-types"
import type { WeixinJobSnapshot, WeixinLastReport } from "@/lib/sogou-weixin"
import { cn } from "@/lib/utils"
import { dateLabel } from "@/lib/date"
import {
  DatabaseZap,
  ListChecks,
  Newspaper,
  Plus,
  RefreshCcw,
  ScanSearch,
  Stethoscope,
  TriangleAlert,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Bowl } from "./bowl"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <h3 className="kicker shrink-0 text-[10px] text-muted-foreground">{children}</h3>
      <span aria-hidden className="h-px flex-1 bg-border/60" />
    </div>
  )
}

function hhmm(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return "—"
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at)
}

/** sync-status 响应里的微信直搜扩展字段（weixinJob / weixinLast） */
type SyncStatusWithWeixin = SyncStatus & {
  weixinJob?: WeixinJobSnapshot
  weixinLast?: WeixinLastReport | null
}

/** 数据源与更新面板：回答「每天怎么更新、全不全、漏了怎么办」的透明度出口 */
export function SyncPanel({
  open,
  onOpenChange,
  season,
  syncing,
  syncElapsed = 0,
  onSync,
  onAddCompany,
  onImported,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  season: Season
  syncing: boolean
  syncElapsed?: number
  onSync: () => void
  onAddCompany: () => void
  onImported?: () => void
}) {
  // 打开时才请求（open 变化触发 useApi 重新拉取）
  const { data } = useApi<SyncStatusWithWeixin>(open ? `/api/sync-status?season=${encodeURIComponent(season)}&_v=${Date.now() % 100000}` : null)
  const report = data?.lastReport ?? null
  const coverage = data?.coverage ?? null
  const queries = report?.queries ?? []

  // ── 查漏体检：独立检索式反向核对名录，产出「疑似遗漏」候选清单（只报告不自动入库）──
  const [auditRunning, setAuditRunning] = useState(false)
  const [auditElapsed, setAuditElapsed] = useState(0)
  const [audit, setAudit] = useState<AuditStatus | null>(null)
  const [dismissed, setDismissed] = useState<string[]>([])
  const [importing, setImporting] = useState<string | null>(null)
  const auditTick = useRef<ReturnType<typeof setInterval> | null>(null)
  const auditPoll = useRef<ReturnType<typeof setInterval> | null>(null)

  // 打开面板时读取上次体检报告（含历史候选，可继续裁决）
  useEffect(() => {
    if (!open) return
    api<AuditStatus>("/api/audit")
      .then((st) => {
        setAudit(st)
        if (st.job.running) {
          setAuditRunning(true)
          setAuditElapsed(Math.round(st.job.elapsedMs / 1000))
        }
      })
      .catch(() => {})
  }, [open])

  // ── 微信公众号直搜：搜狗微信检索公众号推文 → AI 提炼 → 待核入库（独立于主同步的第二管道）──
  const [wxRunning, setWxRunning] = useState(false)
  const [wxElapsed, setWxElapsed] = useState(0)
  const [wxLocal, setWxLocal] = useState<WeixinLastReport | null>(null)
  const wxTick = useRef<ReturnType<typeof setInterval> | null>(null)
  const wxPoll = useRef<ReturnType<typeof setInterval> | null>(null)

  function stopWxTimers() {
    if (wxTick.current) clearInterval(wxTick.current)
    if (wxPoll.current) clearInterval(wxPoll.current)
    wxTick.current = null
    wxPoll.current = null
  }

  /** 开启计时 + 每 2s 轮询 /api/sync-status 的 weixinJob 直到完成（沿用查漏体检的轮询写法） */
  function startWxWait(startElapsed = 0) {
    setWxRunning(true)
    setWxElapsed(startElapsed)
    if (wxTick.current) clearInterval(wxTick.current)
    wxTick.current = setInterval(() => setWxElapsed((s) => s + 1), 1000)
    if (wxPoll.current) clearInterval(wxPoll.current)
    const pollStart = Date.now() - startElapsed * 1000
    wxPoll.current = setInterval(async () => {
      try {
        const st = await api<SyncStatusWithWeixin>(`/api/sync-status?season=${encodeURIComponent(season)}&_v=${Date.now()}`)
        const job = st.weixinJob
        if (!job) return
        if (job.running) {
          if (Date.now() - pollStart > 240_000) {
            stopWxTimers()
            setWxRunning(false)
            toast.error("公众号直搜超过 240 秒未完成，已停止等待；后台多半还在跑，稍后重开面板看结果", { duration: 7000 })
          }
          return
        }
        stopWxTimers()
        setWxRunning(false)
        const r = job.result
        if (job.error) {
          toast.error(`公众号直搜失败：${job.error}`, { duration: 7000 })
          return
        }
        if (r) {
          setWxLocal({ at: new Date(job.finishedAt ?? Date.now()).toISOString(), source: job.source, ...r })
          if (r.errors.length > 0) {
            toast.warning(
              `直搜完成但有 ${r.errors.length} 组关键词失败：${r.errors[0]}${r.candidatesAdded > 0 ? `（仍新收录 ${r.candidatesAdded} 家）` : ""}`,
              { duration: 8000 }
            )
          } else if (r.candidatesAdded > 0) {
            toast.success(`公众号直搜：抓到 ${r.articlesFound} 篇文章，新收录 ${r.candidatesAdded} 家（待核）`, { duration: 7000 })
          } else {
            toast(`公众号直搜完成：${r.message}`, { duration: 7000 })
          }
        }
      } catch {
        // 单次轮询失败不终止
      }
    }, 2000)
  }

  // 打开面板时：清掉本地覆盖报告；若后台任务正在跑（自动时段触发的），恢复等待态继续轮询
  useEffect(() => {
    if (!open) return
    setWxLocal(null)
    api<SyncStatusWithWeixin>(`/api/sync-status?season=${encodeURIComponent(season)}&_v=${Date.now()}`)
      .then((st) => {
        if (st.weixinJob?.running) startWxWait(Math.round(st.weixinJob.elapsedMs / 1000))
      })
      .catch(() => {})
  }, [open])

  async function startWeixinFetch() {
    if (wxRunning) return
    try {
      await api("/api/weixin-sync", { method: "POST", body: JSON.stringify({}) })
      startWxWait(0)
    } catch (e) {
      stopWxTimers()
      setWxRunning(false)
      toast.error(`公众号直搜发起失败：${(e as Error).message}`, { duration: 7000 })
    }
  }

  // 卸载/关面板时清定时器
  useEffect(() => {
    return () => {
      if (auditTick.current) clearInterval(auditTick.current)
      if (auditPoll.current) clearInterval(auditPoll.current)
      if (wxTick.current) clearInterval(wxTick.current)
      if (wxPoll.current) clearInterval(wxPoll.current)
    }
  }, [])

  function stopAuditTimers() {
    if (auditTick.current) clearInterval(auditTick.current)
    if (auditPoll.current) clearInterval(auditPoll.current)
    auditTick.current = null
    auditPoll.current = null
  }

  async function startAudit() {
    if (auditRunning || syncing) return
    setAuditRunning(true)
    setAuditElapsed(0)
    auditTick.current = setInterval(() => setAuditElapsed((s) => s + 1), 1000)
    try {
      await api("/api/audit", { method: "POST", body: JSON.stringify({ season }) })
      const pollStart = Date.now()
      auditPoll.current = setInterval(async () => {
        try {
          const st = await api<AuditStatus>(`/api/audit?_v=${Date.now()}`)
          setAudit(st)
          if (st.job.running) {
            if (Date.now() - pollStart > 180_000) {
              stopAuditTimers()
              setAuditRunning(false)
              toast.error("查漏体检超过 180 秒未完成，已停止等待；后台多半还在跑，稍后再打开面板看报告")
            }
            return
          }
          stopAuditTimers()
          setAuditRunning(false)
          const n = st.lastReport?.candidates?.length ?? 0
          if (st.job.error) {
            toast.error(`查漏体检失败：${st.job.error}`, { duration: 7000 })
          } else if (n > 0) {
            toast.warning(`体检发现 ${n} 家名录之外的企业动态，请在列表里逐条核实`, { duration: 7000 })
          } else {
            toast.success("交叉核对完成：检索触达的企业名录里都有，暂未发现遗漏", { duration: 6000 })
          }
        } catch {
          // 单次轮询失败不终止
        }
      }, 2000)
    } catch (e) {
      stopAuditTimers()
      setAuditRunning(false)
      toast.error(`查漏体检发起失败：${(e as Error).message}`, { duration: 7000 })
    }
  }

  // 采纳候选：录入名录（verified 直入已核目录，语义同「补充企业」）
  async function adoptCandidate(c: AuditCandidate) {
    if (importing) return
    setImporting(c.name)
    try {
      await api("/api/companies", {
        method: "POST",
        body: JSON.stringify({
          name: c.name,
          industry: c.industry || "其他行业",
          city: c.city || "待核",
          summary: c.summary || "查漏体检候选，待补充简介",
          positions: (c.positions ?? []).join(","),
          recruitUrl: c.recruitUrl || "",
          season,
          verified: true,
        }),
      })
      toast.success(`已把「${c.name}」收录进名录`, { duration: 5000 })
      setDismissed((d) => [...d, c.name])
      onImported?.()
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes("已在名录")) {
        toast(`「${c.name}」已在名录中，无需重复收录`)
        setDismissed((d) => [...d, c.name])
      } else {
        toast.error(`收录失败：${msg}`, { duration: 6000 })
      }
    } finally {
      setImporting(null)
    }
  }

  const lastAudit = audit?.lastReport ?? null
  const auditCandidates = (lastAudit?.candidates ?? []).filter((c) => !dismissed.includes(c.name))

  // 微信直搜报告：轮询拿到的新结果优先，否则用落库的上次报告
  const wxReport: WeixinLastReport | null = wxLocal ?? data?.weixinLast ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-lg p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b border-border/70 px-5 pb-3.5 pt-5">
          <DialogTitle className="font-display text-[15px] tracking-wide">数据源与更新</DialogTitle>
          <DialogDescription className="text-[12px] leading-relaxed">
            饭来每天怎么更新、覆盖哪些渠道、漏了怎么办——都在这里说清楚
          </DialogDescription>
        </DialogHeader>

        <div className="scroll-thin max-h-[62vh] overflow-y-auto px-5 pb-4 pt-4">
          {/* 更新机制 */}
          <SectionTitle>更新机制</SectionTitle>
          <div className="mt-2.5 space-y-2 text-[12.5px] leading-relaxed text-foreground/85">
            <p className="flex items-start gap-2">
              <DatabaseZap aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary" strokeWidth={1.6} />
              {data?.schedule.text ?? "每天 08:00（上海时间）后自动同步一次；若失败，每 10 分钟自动补跑直至成功"}。
            </p>
            <p className="pl-5.5 text-[11.5px] text-muted-foreground">
              你也可以随时点「同步今日情报」手动补抓；同步在后台执行，关掉页面也不会中断；「待核」条目核实后才进入正式已核目录。
            </p>
          </div>

          {/* 覆盖渠道：透明展示每轮检索触达的渠道面 */}
          <div className="mt-5">
            <SectionTitle>覆盖渠道</SectionTitle>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {["企业官网/校招页", "微信公众号·服务号", "实习僧", "BOSS直聘", "应届生求职网", "牛客", "高校就业网"].map((ch) => (
                <span
                  key={ch}
                  className="rounded-full border border-border/80 bg-secondary/50 px-2.5 py-1 text-[11px] text-foreground/80"
                >
                  {ch}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
              每轮同步按上述渠道分 12 组定向检索（含搜狗微信收录的 mp.weixin.qq.com 公众号推文），
              命中结果由 AI 提炼成「待核」条目，人工确认后才进正式名录。
            </p>
          </div>

          {/* 微信公众号直搜：搜狗微信文章 → AI 提炼 → 待核入库（第二管道，8/14/20 点自动） */}
          <div className="mt-5">
            <SectionTitle>微信公众号直搜</SectionTitle>
            <div className="mt-2.5 rounded-md border border-border/80 bg-secondary/30 px-3.5 py-3">
              <p className="flex items-start gap-2 text-[12px] leading-relaxed text-foreground/85">
                <Newspaper aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary" strokeWidth={1.6} />
                <span className="min-w-0 flex-1">
                  通过搜狗微信直接检索公众号推文（每天 <span className="tabular-nums">8:00 / 14:00 / 20:00</span> 自动各一轮），
                  AI 从文章里提炼新启动校招的企业，以「待核」入库。
                </span>
              </p>
              <button
                type="button"
                onClick={() => void startWeixinFetch()}
                disabled={wxRunning}
                className="mt-2.5 flex items-center gap-1.5 rounded-md border border-primary/45 bg-card px-3 py-1.5 text-[12px] text-primary transition-colors hover:border-primary hover:bg-primary/10 disabled:opacity-60"
              >
                <Newspaper className="size-3.5" strokeWidth={1.6} />
                {wxRunning ? `抓取中 · ${wxElapsed}s（约 40-80s）` : "立即抓取"}
              </button>

              {wxReport ? (
                <div className="mt-3 border-t border-border/60 pt-3">
                  <p className="text-[11px] text-muted-foreground">
                    上次抓取 {hhmm(wxReport.at)} · 抓到文章 <span className="text-foreground/80">{wxReport.articlesFound}</span> 篇 ·{" "}
                    {wxReport.candidatesAdded > 0 ? (
                      <span className="text-primary">新收录 {wxReport.candidatesAdded} 家</span>
                    ) : (
                      "未新增企业"
                    )}
                  </p>
                  {wxReport.addedItems.length > 0 && (
                    <p className="mt-1 text-[11px] leading-relaxed text-foreground/75">新收录：{wxReport.addedItems.join("、")}</p>
                  )}
                  {wxReport.candidatesAdded === 0 && wxReport.message && (
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{wxReport.message}</p>
                  )}
                  {wxReport.errors.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {wxReport.errors.map((e, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-[color:var(--crimson-deep)]">
                          <TriangleAlert aria-hidden className="mt-0.5 size-3 shrink-0" strokeWidth={1.6} />
                          {e}
                        </li>
                      ))}
                    </ul>
                  )}
                  {wxReport.recentArticles.length > 0 && (
                    <ul className="mt-2.5 space-y-1">
                      {wxReport.recentArticles.slice(0, 5).map((a) => (
                        <li key={a.link}>
                          <a
                            href={a.link}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-baseline justify-between gap-2 rounded px-1 py-0.5 transition-colors hover:bg-secondary/60"
                            title={a.title}
                          >
                            <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground/85 underline decoration-border/70 underline-offset-2">
                              {a.title}
                            </span>
                            <span className="max-w-[38%] shrink-0 truncate text-right text-[10.5px] text-muted-foreground/75">
                              {a.account}
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <p className="mt-3 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                  还没有直搜记录——点「立即抓取」跑一轮，或等下个自动时段。
                </p>
              )}
            </div>
          </div>

          {/* 查漏体检：独立检索式交叉核对 */}
          <div className="mt-5">
            <SectionTitle>查漏体检</SectionTitle>
            <div className="mt-2.5 rounded-md border border-border/80 bg-secondary/30 px-3.5 py-3">
              <p className="flex items-start gap-2 text-[12px] leading-relaxed text-foreground/85">
                <ScanSearch aria-hidden className="mt-0.5 size-3.5 shrink-0 text-[#d96a2b]" strokeWidth={1.6} />
                <span className="min-w-0 flex-1">
                  用一套与每日同步<span className="font-medium">完全不重叠</span>
                  的检索式——8 条优先赛道逐行业 + 牛客 / 应届生渠道扫描——反向核对名录，报告「名录之外」的企业候选。
                  <span className="text-muted-foreground">只提示、不自动入库，收不收由你裁决。</span>
                </span>
              </p>
              <button
                type="button"
                onClick={() => void startAudit()}
                disabled={auditRunning || syncing}
                className="mt-2.5 flex items-center gap-1.5 rounded-md border border-[#d96a2b]/45 bg-card px-3 py-1.5 text-[12px] text-[#b5541e] transition-colors hover:border-[#d96a2b] hover:bg-[#d96a2b]/10 disabled:opacity-60 dark:text-[#ef9a63]"
              >
                {auditRunning ? <Stethoscope className="size-3.5 animate-pulse" strokeWidth={1.6} /> : <Stethoscope className="size-3.5" strokeWidth={1.6} />}
                {auditRunning ? `体检中 · ${auditElapsed}s（约 40-60s）` : "开始查漏体检"}
              </button>

              {/* 体检结果：候选清单 */}
              {lastAudit && (
                <div className="mt-3 border-t border-border/60 pt-3">
                  <p className="text-[11px] text-muted-foreground">
                    上次体检 {hhmm(lastAudit.at)} · 检索命中 {lastAudit.searched} 条 ·{" "}
                    {lastAudit.candidates.length > 0 ? (
                      <span className="text-[#b5541e] dark:text-[#ef9a63]">发现 {lastAudit.candidates.length} 家疑似遗漏</span>
                    ) : (
                      lastAudit.note || "暂未发现遗漏"
                    )}
                  </p>
                  {auditCandidates.length > 0 && (
                    <ul className="mt-2 space-y-2">
                      {auditCandidates.map((c) => (
                        <li
                          key={c.name}
                          className="rounded-md border border-border/70 bg-card px-3 py-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                <span className="font-display text-[13.5px] font-semibold">{c.name}</span>
                                {c.industry && (
                                  <span className="rounded-full bg-secondary px-1.5 py-px text-[10.5px] leading-4 text-muted-foreground">
                                    {c.industry}
                                  </span>
                                )}
                                {c.city && c.city !== "待核" && (
                                  <span className="text-[10.5px] tabular-nums text-muted-foreground">{c.city}</span>
                                )}
                              </p>
                              {c.summary && (
                                <p className="mt-1 text-[11.5px] leading-relaxed text-foreground/75">{c.summary}</p>
                              )}
                              {c.evidence && (
                                <p className="mt-1 truncate text-[10.5px] text-muted-foreground/70" title={c.evidence}>
                                  证据：{c.evidence}
                                </p>
                              )}
                            </div>
                            <div className="flex shrink-0 flex-col gap-1">
                              <button
                                type="button"
                                onClick={() => void adoptCandidate(c)}
                                disabled={importing !== null}
                                className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[10.5px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
                              >
                                <Plus className="size-3" strokeWidth={1.8} />
                                {importing === c.name ? "收录中…" : "收录"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setDismissed((d) => [...d, c.name])}
                                className="flex items-center justify-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
                              >
                                <X className="size-3" strokeWidth={1.6} />
                                不收
                              </button>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 最近一轮执行报告 */}
          <div className="mt-5">
            <SectionTitle>最近一轮同步报告</SectionTitle>
            {!report ? (
              <p className="mt-2.5 text-[12px] leading-relaxed text-muted-foreground">
                还没有同步记录——点右下角「再同步一轮」立即抓取一次。
              </p>
            ) : (
              <div className="mt-2.5 rounded-md border border-border/80 bg-secondary/30 px-3.5 py-3">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px] tabular-nums">
                  <span className="text-muted-foreground">{hhmm(report.at)}</span>
                  <span>{report.source === "auto" ? "自动推送" : "手动同步"}</span>
                  <span>检索命中 <span className="font-medium text-foreground">{report.searched}</span> 条</span>
                  {report.added > 0 && <span className="text-primary">新收录 {report.added} 家</span>}
                  {report.refreshed > 0 && <span>重新送达 {report.refreshed} 家</span>}
                </div>
                {queries.length > 0 && (
                  <>
                    <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <ListChecks aria-hidden className="size-3.5" strokeWidth={1.6} />
                      {report.okCount}/{queries.length} 组关键词检索成功
                      {(report.failCount ?? 0) > 0 && "（失败组已自动重试仍未成功，可再同步一轮补抓）"}
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {queries.map((qr) => (
                        <li key={qr.q} className="flex items-start gap-2 text-[11px] leading-relaxed">
                          <span
                            aria-hidden
                            className={cn(
                              "mt-[5px] size-1.5 shrink-0 rounded-full",
                              qr.ok ? "bg-primary/70" : "bg-[color:var(--crimson)]"
                            )}
                          />
                          <span className={cn("min-w-0", qr.ok ? "text-foreground/75" : "text-[color:var(--crimson-deep)]")}>
                            「{qr.q}」
                            {qr.ok ? (
                              <span className="text-muted-foreground/70"> · {qr.hits} 条结果{qr.attempts > 1 ? `（第 ${qr.attempts} 次重试成功）` : ""}</span>
                            ) : (
                              <span> · 未成功：{qr.error ?? "未知原因"}</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 数据流水线 */}
          <div className="mt-5">
            <SectionTitle>信息流水线</SectionTitle>
            <ol className="mt-2.5 space-y-2.5">
              {(data?.pipeline ?? []).map((p) => (
                <li key={p.step} className="flex items-start gap-3">
                  <span className="font-display w-16 shrink-0 text-[11.5px] font-medium tracking-wide text-primary">{p.step}</span>
                  <span className="text-[12px] leading-relaxed text-muted-foreground">{p.detail}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* 覆盖统计 */}
          {coverage && (
            <div className="mt-5">
              <SectionTitle>{season}名录覆盖</SectionTitle>
              <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-2 text-[12px] tabular-nums">
                <span>已收录 <span className="font-display text-[15px] font-semibold">{coverage.total}</span> 家</span>
                <span className="text-muted-foreground">已核 {coverage.verifiedCount}</span>
                <span className="text-muted-foreground">待核 {coverage.pendingCount}</span>
                <span className="text-muted-foreground">今日送达 {coverage.todayCount}</span>
              </div>
              {coverage.recentBatches.length > 0 && (
                <div className="mt-3 flex items-end gap-1" aria-label="近 7 天每日放出家数">
                  {coverage.recentBatches.map((b) => {
                    const max = Math.max(...coverage.recentBatches.map((x) => x.count), 1)
                    return (
                      <div key={b.date} className="flex flex-1 flex-col items-center gap-1">
                        <div
                          className={cn("w-full rounded-t-[2px]", b.count > 0 ? "bg-primary/55" : "bg-border/50")}
                          style={{ height: `${Math.max(3, Math.round((b.count / max) * 34))}px` }}
                          title={`${b.date}：${b.count} 家`}
                        />
                        <span className="text-[8.5px] tabular-nums text-muted-foreground/75">{b.date.slice(8)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* 已知边界（诚实说明遗漏风险） */}
          <div className="mt-5">
            <SectionTitle>诚实边界：可能漏掉什么</SectionTitle>
            <ul className="mt-2.5 space-y-2">
              {(data?.limitations ?? []).map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px] leading-relaxed text-muted-foreground">
                  <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-[color:var(--crimson)]" strokeWidth={1.6} />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* 底部动作：再同步一轮 / 补充企业 */}
        <div className="flex items-center justify-between gap-3 border-t border-border/70 px-5 py-3.5">
          <p className="hidden text-[10.5px] text-muted-foreground/80 sm:block">
            {data ? `数据口径 ${dateLabel(data.today)} · 上海时间` : "数据口径以服务端为准"}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onAddCompany}
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3.5 py-1.5 text-[12px] text-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <Plus className="size-3.5" strokeWidth={1.6} />
              补充企业
            </button>
            <button
              type="button"
              onClick={onSync}
              disabled={syncing}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {syncing ? <Bowl mood="cook" size={15} /> : <RefreshCcw className="size-3.5" strokeWidth={1.6} />}
              {syncing ? (syncElapsed > 0 ? `同步中 · ${syncElapsed}s` : "同步中…") : "再同步一轮"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
