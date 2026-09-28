"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { AnimatePresence, motion } from "framer-motion"
import { useApi } from "@/hooks/use-api"
import { api } from "@/lib/types"
import { syncPhaseText } from "@/lib/copy"
import type { ApplicationRecord, BatchInfo, Company, CompaniesResponse, DeadlinesResponse, Season, Stats } from "@/lib/types"
import { shanghaiToday } from "@/lib/date"
import { cn } from "@/lib/utils"
import { SiteHeader, type Tab } from "./site-header"
import { SiteFooter } from "./site-footer"
import { MobileTabbar } from "./mobile-tabbar"
import { TodayView } from "./today-view"
import { DirectoryView } from "./directory-view"
import { TrackerView } from "./tracker-view"
import { DeadlineView } from "./deadline-view"
import { ShortlistView } from "./shortlist-view"
import { InsightsView } from "./insights-view"
import { CompanyDetail } from "./company-detail"
import { ApplyDialog } from "./apply-dialog"
import { CommandPalette } from "./command-palette"
import { SyncPanel } from "./sync-panel"
import { AddCompanyDialog } from "./add-company-dialog"
import { Bowl } from "./bowl"
import { OceanBackground } from "./ocean-background"
import { CoverHero } from "./cover-hero"

/** /api/sync-status 返回的后台同步任务快照（前端轮询用） */
interface SyncJobLike {
  running: boolean
  startedAt: number
  finishedAt: number | null
  result: {
    added: number
    refreshed: number
    failedQueries: number
    message: string
  } | null
  error: string | null
}

export function FanLaiApp() {
  // ── 打开即用：登录门控已按用户反馈移除（Task 26-f），进站直达封面 ──
  const [tab, setTab] = useState<Tab>("today")
  const [version, setVersion] = useState(0) // 全局数据版本：任何写操作后 +1 触发刷新
  // 季节初值固定为「秋招」：SSR 与客户端首帧必须渲染同一棵树。
  // localStorage / URL 里的偏好统一在水合后的 effect 中恢复（见下方 urlHydrated effect），
  // 否则「typeof window」分支会让两棵树结构分叉，触发 Radix useId 水合错配。
  const [season, setSeason] = useState<Season>("秋招")

  const onSelectSeason = (s: Season) => {
    setSeason(s)
    try {
      window.localStorage.setItem("fanlai-season", s)
    } catch {}
    setSelectedDay(shanghaiToday()) // 切季重置到今日，避免停留在另一季的旧批次
    window.scrollTo({ top: 0 })
  }

  // ── 今日视图状态 ──
  const [selectedDay, setSelectedDay] = useState<string>(() => shanghaiToday())

  // ── 名录视图状态（pageSize 增量加载：24 → 48 → 72 → 96）──
  const [q, setQ] = useState("")
  const [industries, setIndustries] = useState<string[]>([]) // 多选行业（空数组 = 全部）
  const [starredOnly, setStarredOnly] = useState(false)
  const [hasAppOnly, setHasAppOnly] = useState(false) // 仅有投递记录的企业
  const [includeHidden, setIncludeHidden] = useState(false) // 含已忽略（找回误忽略的待核条目）
  const [sort, setSort] = useState("newest")
  const [viewMode, setViewMode] = useState<"list" | "grid">("list")
  const [pageSize, setPageSize] = useState(24)

  // ── 看板视图状态（提升到全局以便 URL 同步）──
  const [boardFilter, setBoardFilter] = useState("")
  const [calMonth, setCalMonth] = useState(() => shanghaiToday().slice(0, 7))

  // ── 弹层状态 ──
  const [detailCompany, setDetailCompany] = useState<Company | null>(null)
  const [applyCompany, setApplyCompany] = useState<Company | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [syncPanelOpen, setSyncPanelOpen] = useState(false)
  const [addCompanyOpen, setAddCompanyOpen] = useState(false)

  // ── 键盘快捷键：⌘/Ctrl+K 命令面板，1-4 切换视图（输入焦点时忽略）──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return
      const map: Record<string, Tab> = { "1": "today", "2": "directory", "3": "tracker", "4": "deadlines", "5": "shortlist", "6": "insights" }
      const next = map[e.key]
      if (next) {
        setTab(next)
        window.scrollTo({ top: 0 })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // ── URL 状态同步：水合后从 ?tab=directory&q=… 恢复视图与筛选；变化时 replaceState 写回 ──
  // （必须放在所有 state 声明之后：依赖数组在渲染期求值，提前引用会触发 TDZ）
  const [urlHydrated, setUrlHydrated] = useState(false)
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const t = sp.get("tab")
    if (t === "directory" || t === "tracker" || t === "today" || t === "deadlines" || t === "shortlist" || t === "insights") setTab(t)
    const s = sp.get("season")
    if (s === "春招" || s === "社招" || s === "秋招") {
      setSeason(s)
      try {
        window.localStorage.setItem("fanlai-season", s)
      } catch {}
    } else {
      // URL 未指定时回落到用户上次的季节偏好（localStorage）
      try {
        const saved = window.localStorage.getItem("fanlai-season")
        if (saved === "春招" || saved === "社招") setSeason(saved)
      } catch {}
    }
    const day = sp.get("day")
    if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) setSelectedDay(day)
    // 行业多选（ind=a,b,c）优先；兼容旧单选参数 industry
    const inds = sp.get("ind")
    const legacyInd = sp.get("industry")
    if (inds) {
      const list = inds.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12)
      if (list.length > 0) setIndustries(list)
    } else if (legacyInd && legacyInd !== "全部") {
      setIndustries([legacyInd])
    }
    const qs = sp.get("q")
    if (qs) setQ(qs)
    if (sp.get("starred") === "1") setStarredOnly(true)
    if (sp.get("app") === "1") setHasAppOnly(true)
    if (sp.get("hidden") === "1") setIncludeHidden(true)
    const st = sp.get("sort")
    if (st === "newest" || st === "oldest" || st === "name" || st === "deadline") setSort(st)
    const v = sp.get("view")
    if (v === "list" || v === "grid") setViewMode(v)
    const bq = sp.get("tq")
    if (bq) setBoardFilter(bq)
    const mth = sp.get("m")
    if (mth && /^\d{4}-\d{2}$/.test(mth)) setCalMonth(mth)
    setUrlHydrated(true)
  }, [])

  useEffect(() => {
    if (!urlHydrated) return
    const sp = new URLSearchParams()
    if (tab !== "today") sp.set("tab", tab)
    if (season !== "秋招") sp.set("season", season)
    if (tab === "today" && selectedDay !== shanghaiToday()) sp.set("day", selectedDay)
    if (industries.length > 0) sp.set("ind", industries.join(","))
    if (q) sp.set("q", q)
    if (starredOnly) sp.set("starred", "1")
    if (hasAppOnly) sp.set("app", "1")
    if (includeHidden) sp.set("hidden", "1")
    if (sort !== "newest") sp.set("sort", sort)
    if (viewMode !== "list") sp.set("view", viewMode)
    if (boardFilter) sp.set("tq", boardFilter)
    if (tab === "deadlines") {
      if (calMonth !== shanghaiToday().slice(0, 7)) sp.set("m", calMonth)
    }
    const qs = sp.toString()
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname)
  }, [urlHydrated, tab, season, selectedDay, industries, q, starredOnly, hasAppOnly, includeHidden, sort, viewMode, boardFilter, calMonth])

  const todayPath = `/api/companies?season=${season}&date=${selectedDay}&pageSize=96&sort=oldest&_v=${version}`
  const batchesPath = `/api/companies/batches?season=${season}&_v=${version}`
  const statsPath = `/api/stats?season=${season}&_v=${version}`
  const appsPath = `/api/applications?_v=${version}`
  const starredPath = `/api/companies?starred=1&season=${season}&pageSize=96&sort=deadline&_v=${version}`
  const deadlinesPath = `/api/deadlines?month=${calMonth}&season=${season}&_v=${version}`

  const dirQuery = useMemo(() => {
    const sp = new URLSearchParams({ pageSize: String(pageSize), page: "1", season })
    if (q) sp.set("q", q)
    if (industries.length > 0) sp.set("industries", industries.join(","))
    if (starredOnly) sp.set("starred", "1")
    if (hasAppOnly) sp.set("hasApp", "1")
    if (includeHidden) sp.set("includeHidden", "1")
    sp.set("sort", sort)
    return `/api/companies?${sp.toString()}&_v=${version}`
  }, [q, industries, starredOnly, hasAppOnly, includeHidden, sort, pageSize, version, season])

  const { data: todayData } = useApi<CompaniesResponse>(todayPath)
  const { data: batches } = useApi<{ today: string; recent: BatchInfo[] }>(batchesPath)
  const { data: stats } = useApi<Stats>(statsPath)
  const { data: appsData } = useApi<{ items: ApplicationRecord[] }>(appsPath)
  const { data: dirData, loading: dirLoading } = useApi<CompaniesResponse>(dirQuery)
  const { data: starredData, loading: starredLoading } = useApi<CompaniesResponse>(starredPath)
  const { data: deadlinesData, loading: deadlinesLoading } = useApi<DeadlinesResponse>(deadlinesPath)

  // 筛选变化时重置每页数量（避免 effect 级联 setState）
  const onQChange = (v: string) => {
    setQ(v)
    setPageSize(24)
  }
  const onIndustryToggle = (v: string) => {
    setIndustries((list) => (list.includes(v) ? list.filter((i) => i !== v) : [...list, v]))
    setPageSize(24)
  }
  const onIndustriesClear = () => {
    setIndustries([])
    setPageSize(24)
  }
  const onStarredChange = (v: boolean) => {
    setStarredOnly(v)
    setPageSize(24)
  }
  const onHasAppChange = (v: boolean) => {
    setHasAppOnly(v)
    setPageSize(24)
  }
  const onIncludeHiddenChange = (v: boolean) => {
    setIncludeHidden(v)
    setPageSize(24)
  }
  const onSortChange = (v: string) => {
    setSort(v)
    setPageSize(24)
  }

  function bump() {
    setVersion((n) => n + 1)
  }

  async function handleStar(company: Company) {
    // 详情弹层乐观更新，列表靠 bump() 全局刷新
    setDetailCompany((d) => (d && d.id === company.id ? { ...d, starred: !d.starred } : d))
    try {
      await api<Company>(`/api/companies/${company.id}`, {
        method: "PATCH",
        body: JSON.stringify({ starred: !company.starred }),
      })
      toast.success(company.starred ? `已取消「${company.name}」的星标` : `已将「${company.name}」加入星标`)
      bump()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleSaved = () => bump()

  // ── 清单置顶（仅在星标清单内排序生效）──
  async function handlePin(company: Company) {
    setDetailCompany((d) => (d && d.id === company.id ? { ...d, pinned: !d.pinned } : d))
    try {
      await api<Company>(`/api/companies/${company.id}`, {
        method: "PATCH",
        body: JSON.stringify({ pinned: !company.pinned }),
      })
      toast.success(company.pinned ? `已取消「${company.name}」置顶` : `已将「${company.name}」置顶`)
      bump()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // ── 待核情报批量审核（全部确认 / 全部忽略）──
  const [reviewing, setReviewing] = useState(false)
  async function handleReview(action: "confirm" | "ignore") {
    if (reviewing) return
    setReviewing(true)
    try {
      const res = await api<{ updated: number; message: string }>("/api/companies/review", {
        method: "POST",
        body: JSON.stringify({ action, all: true, season }),
      })
      if (res.updated > 0) {
        toast.success(res.updated > 1 ? res.message : `已${action === "confirm" ? "确认收录" : "忽略"} ${res.updated} 条`)
      } else {
        toast(res.message ?? "没有待处理的条目", { duration: 3500 })
      }
      bump()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setReviewing(false)
    }
  }

  // ── 单条忽略 / 恢复（详情侧滑内操作）──
  async function handleHidden(c: Company, hidden: boolean) {
    try {
      await api<Company>(`/api/companies/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({ hidden }),
      })
      toast.success(hidden ? `已忽略「${c.name}」，可在名录「含已忽略」中找回` : `已恢复「${c.name}」显示`)
      setDetailCompany((d) => (d && d.id === c.id ? { ...d, hidden } : d))
      bump()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // ── 投递日历：截止时间核对闭环（我已核对 / 官网查到不同日期就地修正）──
  async function handleDeadlineConfirm(c: Company) {
    try {
      await api("/api/deadlines", {
        method: "PATCH",
        body: JSON.stringify({ id: c.id, confirm: true }),
      })
      toast.success(`已标记「${c.name}」的截止时间为官网核对过`)
      bump()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function handleDeadlineCorrect(c: Company, date: string) {
    try {
      await api("/api/deadlines", {
        method: "PATCH",
        body: JSON.stringify({ id: c.id, deadline: date }),
      })
      toast.success(`「${c.name}」的截止时间已修正为 ${date}（并标记已核对）`)
      bump()
    } catch (e) {
      toast.error((e as Error).message)
      throw e
    }
  }

  // ── 同步今日情报（异步任务模式）──
  // POST /api/refresh 立即返回 202 受理，检索+LLM 在服务端后台执行；
  // 前端每 2s 轮询 GET /api/sync-status 的 job 字段取进度与结果。
  // 这是 502 的根治：网关不再挂 30~90s 的长请求（超时断开），等待全程可见、结果必达。
  const [syncing, setSyncing] = useState(false)
  const [syncElapsed, setSyncElapsed] = useState(0)
  const syncTick = useRef<ReturnType<typeof setInterval> | null>(null)
  const syncPoll = useRef<ReturnType<typeof setInterval> | null>(null)
  const syncSentAt = useRef(0)
  const syncPollStart = useRef(0)

  function stopSyncTimers() {
    if (syncTick.current) clearInterval(syncTick.current)
    if (syncPoll.current) clearInterval(syncPoll.current)
    syncTick.current = null
    syncPoll.current = null
  }

  function finishSync() {
    stopSyncTimers()
    setSyncing(false)
  }

  async function handleSync() {
    if (syncing) return
    setSyncing(true)
    setSyncElapsed(0)
    // 秒表：驱动悬浮热饭卡与按钮上的耗时/阶段文案
    syncTick.current = setInterval(() => setSyncElapsed((s) => s + 1), 1000)
    try {
      const res = await api<{ started: boolean; alreadyRunning: boolean; job: { startedAt: number } | null }>(
        "/api/refresh",
        { method: "POST", body: JSON.stringify({ season }) }
      )
      syncSentAt.current = res.job?.startedAt ?? Date.now()
      syncPollStart.current = Date.now()
      // 轮询任务状态：2s 一次，最长等 180s（后台任务正常 30~90s 跑完）
      syncPoll.current = setInterval(async () => {
        try {
          const st = await api<{ job: SyncJobLike }>(
            `/api/sync-status?season=${encodeURIComponent(season)}&_v=${Date.now()}`
          )
          const job = st.job
          if (!job) return
          if (job.running) {
            if (Date.now() - syncPollStart.current > 180_000) {
              finishSync()
              toast.error("获取数据失败：同步超过 180 秒仍未完成，已停止等待。后台多半还在跑，结果稍后会出现在「数据源与更新」面板", {
                duration: 9000,
                action: { label: "再试一次", onClick: () => void handleSync() },
              })
            }
            return
          }
          finishSync()
          // 只认本轮受理的那次结果（startedAt 匹配，容忍 1s 内时钟毫秒差）
          if (job.startedAt < syncSentAt.current - 1000) return
          const r = job.result
          if (!r) {
            if (job.error) {
              toast.error(`获取数据失败：${job.error}`, {
                duration: 9000,
                action: { label: "再试一次", onClick: () => void handleSync() },
              })
            }
            return
          }
          // 部分检索失败：如实告知，这轮可能不全，可补抓
          if (r.failedQueries > 0) {
            toast.warning(`${r.failedQueries} 组检索没跑成，这轮可能不全——可再同步一轮补抓`, { duration: 6000 })
          }
          if (r.added > 0) {
            toast.success(`饭来啦！${r.message}`, { duration: 7000 })
          } else {
            toast(`这轮没添新菜 · ${r.message}`, { duration: 5000 })
          }
          bump()
        } catch {
          // 单次轮询失败（网关抖动）不终止，由总超时兜底
        }
      }, 2000)
    } catch (e) {
      finishSync()
      const reason = (e as Error).message || "网络开小差了"
      toast.error(`获取数据失败：${reason}`, {
        duration: 9000,
        action: { label: "再试一次", onClick: () => void handleSync() },
      })
    }
  }

  // 「不等了」：只停止本端的等待（秒表+轮询+热饭卡），服务端继续做完落库，数据不丢
  function cancelSync() {
    finishSync()
    toast("已收火，这轮先不等了——后台会继续做完，结果在「数据源与更新」可见", { duration: 4500 })
  }

  const applications = appsData?.items ?? null

  return (
    <div className="flex min-h-screen flex-col">
      {/* 全站海浪背景：随实时时间换色、随滚动下沉、波幅可调（Task 26-d） */}
      <OceanBackground />

      {/* 视图环境光：五声部底色薄雾随 tab 淡入淡出（叠在海浪层之上） */}
      <AnimatePresence initial={false}>
        <motion.div
          key={`ambient-${tab}`}
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45 }}
          className={cn("fanlai-ambient", `ambient-${tab}`)}
        />
      </AnimatePresence>

      <SiteHeader
        tab={tab}
        onTab={(t) => {
          setTab(t)
          window.scrollTo({ top: 0 })
        }}
        season={season}
        onSeason={onSelectSeason}
        today={stats?.today ?? shanghaiToday()}
        appliedCount={stats?.appliedTotal ?? 0}
        starredCount={stats?.starred ?? 0}
        onSearch={() => setPaletteOpen(true)}
      />

      <main className="flex-1">
        {/* 视图切换转场：同一套出入场节奏，切换不再是硬切 */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.26, ease: "easeOut" }}
          >
            {tab === "today" && (
              <>
                {/* 产品封面：左幅海上日出运镜，右幅杂志刊头（Task 26-e/l/m） */}
                <CoverHero stats={stats} companies={todayData?.items ?? null} todayCount={todayData?.items.length ?? 0} season={season} />
                <TodayView
            stats={stats}
            batches={batches?.recent ?? null}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
            companies={todayData?.items ?? null}
            loading={todayData === null}
            season={season}
            onDetail={setDetailCompany}
            onApply={setApplyCompany}
            onStar={handleStar}
            onSync={handleSync}
            syncing={syncing}
            syncInfo={syncing ? `热饭中 · ${syncElapsed}s · ${syncPhaseText(syncElapsed)}` : null}
            onReview={handleReview}
            reviewing={reviewing}
                onOpenSyncPanel={() => setSyncPanelOpen(true)}
              />
              </>
            )}

        {tab === "directory" && (
          <DirectoryView
            season={season}
            q={q}
            onQ={onQChange}
            industries={industries}
            onToggleIndustry={onIndustryToggle}
            onClearIndustries={onIndustriesClear}
            starredOnly={starredOnly}
            onStarredOnly={onStarredChange}
            hasAppOnly={hasAppOnly}
            onHasAppOnly={onHasAppChange}
            includeHidden={includeHidden}
            onIncludeHidden={onIncludeHiddenChange}
            sort={sort}
            onSort={onSortChange}
            data={dirData}
            loading={dirLoading}
            onLoadMore={() => setPageSize((p) => Math.min(96, p + 24))}
            viewMode={viewMode}
            onViewMode={setViewMode}
            onDetail={setDetailCompany}
            onApply={setApplyCompany}
            onStar={handleStar}
            onAddCompany={() => setAddCompanyOpen(true)}
          />
        )}

        {tab === "tracker" && (
          <TrackerView
            applications={applications}
            loading={applications === null}
            filter={boardFilter}
            onFilter={setBoardFilter}
            onDetail={setDetailCompany}
            onStatusChange={async (app, status) => {
              try {
                await api(`/api/applications/${app.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ status }),
                })
                toast.success(`「${app.company?.name}」已移至 ${status}`)
                bump()
              } catch (e) {
                toast.error((e as Error).message)
              }
            }}
            onDelete={async (app) => {
              try {
                await api(`/api/applications/${app.id}`, { method: "DELETE" })
                toast.success(`已删除「${app.company?.name}」的记录`)
                bump()
              } catch (e) {
                toast.error((e as Error).message)
              }
            }}
            onGoDirectory={() => setTab("directory")}
            onGoDeadlines={() => {
              setTab("deadlines")
              window.scrollTo({ top: 0 })
            }}
          />
        )}
        {tab === "deadlines" && (
          <DeadlineView
            data={deadlinesData}
            loading={deadlinesLoading}
            month={calMonth}
            onMonth={setCalMonth}
            today={stats?.today ?? shanghaiToday()}
            onDetail={setDetailCompany}
            onConfirm={handleDeadlineConfirm}
            onCorrect={handleDeadlineCorrect}
            onGoDirectory={() => {
              onSortChange("deadline")
              setTab("directory")
              window.scrollTo({ top: 0 })
            }}
          />
        )}
        {tab === "shortlist" && (
          <ShortlistView
            data={starredData}
            loading={starredLoading}
            onDetail={setDetailCompany}
            onApply={setApplyCompany}
            onStar={handleStar}
            onPin={handlePin}
            onGoDirectory={() => setTab("directory")}
          />
        )}

        {tab === "insights" && (
          <InsightsView
            applications={applications}
            loading={applications === null}
            season={season}
            today={stats?.today ?? shanghaiToday()}
            starredPendingCount={(starredData?.items ?? []).filter((c) => !c.application).length}
            onGoDirectory={() => setTab("directory")}
          />
        )}
          </motion.div>
        </AnimatePresence>
      </main>

      <SiteFooter season={season} today={stats?.today ?? shanghaiToday()} onImported={() => bump()} />

      {/* 底部 Tabbar 占位：让 sticky footer 不被固定导航遮挡（Tabbar 自身 sm:hidden） */}
      <div aria-hidden className="h-[57px] sm:hidden" style={{ height: "calc(57px + env(safe-area-inset-bottom))" }} />

      <MobileTabbar
        tab={tab}
        onTab={(t) => {
          setTab(t)
          window.scrollTo({ top: 0 })
        }}
        appliedCount={stats?.appliedTotal ?? 0}
        starredCount={stats?.starred ?? 0}
      />

      <CompanyDetail
        company={detailCompany}
        onClose={() => setDetailCompany(null)}
        onApply={(c) => setApplyCompany(c)}
        onStar={handleStar}
        onVerified={(c) =>
          setDetailCompany((d) => (d && d.id === c.id ? { ...d, verified: true } : d))
        }
        onHidden={handleHidden}
        onOpenCompany={setDetailCompany}
        onDeleteApp={async (app) => {
          try {
            await api(`/api/applications/${app.id}`, { method: "DELETE" })
            toast.success(`已删除「${app.company?.name} · ${app.position}」的记录`)
            bump()
          } catch (e) {
            toast.error((e as Error).message)
          }
        }}
        onUpdateNotes={async (app, notes) => {
          try {
            await api(`/api/applications/${app.id}`, {
              method: "PATCH",
              body: JSON.stringify({ notes }),
            })
            toast.success(notes ? "笔记已保存" : "笔记已清空")
            bump()
          } catch (e) {
            toast.error((e as Error).message)
            throw e
          }
        }}
        apps={(detailCompany && applications?.filter((a) => a.companyId === detailCompany.id)) || []}
      />

      <ApplyDialog
        company={applyCompany}
        apps={(applyCompany && applications?.filter((a) => a.companyId === applyCompany.id)) || []}
        onClose={() => setApplyCompany(null)}
        onSaved={handleSaved}
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onGoTab={(t) => {
          setTab(t)
          window.scrollTo({ top: 0 })
        }}
        onOpenCompany={setDetailCompany}
        onOpenApply={(c) => setApplyCompany(c)}
        onDataChanged={() => bump()}
        onSync={() => {
          void handleSync()
        }}
        onSearchInDirectory={(qs) => {
          onQChange(qs)
          setTab("directory")
          window.scrollTo({ top: 0 })
        }}
        onOpenCalendar={() => {
          setTab("tracker")
          setBoardMode("calendar")
          window.scrollTo({ top: 0 })
        }}
        onDirectoryDeadlineSort={() => {
          onSortChange("deadline")
          setTab("directory")
          window.scrollTo({ top: 0 })
        }}
        season={season}
        onSeason={onSelectSeason}
      />

      {/* 数据源与更新：透明度面板 + 手动补充企业兑底 */}
      <SyncPanel
        open={syncPanelOpen}
        onOpenChange={setSyncPanelOpen}
        season={season}
        syncing={syncing}
        syncElapsed={syncElapsed}
        onSync={handleSync}
        onImported={bump}
        onAddCompany={() => {
          setSyncPanelOpen(false)
          setAddCompanyOpen(true)
        }}
      />

      <AddCompanyDialog
        open={addCompanyOpen}
        onOpenChange={setAddCompanyOpen}
        season={season}
        onAdded={(name) => {
          setAddCompanyOpen(false)
          toast.success(`已补充「${name}」进入今日名录`)
          bump()
        }}
      />

      {/* 悬浮热饭卡：同步进行中的常驻可见反馈（任何视图/弹层之上），可随时「不等了」收火 */}
      <AnimatePresence>
        {syncing && (
          <motion.div
            key="fanlai-cooking"
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="fixed bottom-[calc(64px+env(safe-area-inset-bottom))] right-3 z-50 sm:bottom-5 sm:right-5"
          >
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card/95 py-2.5 pl-3.5 pr-2 shadow-[0_6px_24px_rgba(32,29,25,0.16)] backdrop-blur-sm dark:shadow-[0_6px_24px_rgba(0,0,0,0.5)]">
              <Bowl mood="cook" size={34} />
              <div className="min-w-0">
                <p className="font-display text-[13px] font-semibold leading-tight tabular-nums">热饭中 · {syncElapsed}s</p>
                <p className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">{syncPhaseText(syncElapsed)}</p>
              </div>
              <button
                onClick={cancelSync}
                className="ml-1 shrink-0 rounded-md border border-border/80 px-2 py-1 text-[10.5px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
              >
                不等了
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
