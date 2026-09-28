"use client"

import Image from "next/image"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { CalendarClock, Download, Inbox, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { dateLabel, daysUntil, toShanghaiDateStr } from "@/lib/date"
import { deadlineBadge } from "@/lib/deadline"
import {
  api,
  STATUS_DOT,
  STATUS_ORDER,
  type ApplicationRecord,
  type Company,
} from "@/lib/types"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
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
import { CompanyAvatar } from "./company-avatar"
import { ViewBanner } from "./view-banner"

/** 列内排序：未过期按剩余天数升序 → 无 DDL → 已过期（久过期沉底） */
export function sortByDeadline(list: ApplicationRecord[]): ApplicationRecord[] {
  const group = (a: ApplicationRecord) => {
    if (!a.deadline) return 1
    return daysUntil(a.deadline) >= 0 ? 0 : 2
  }
  return [...list].sort((a, b) => {
    const ga = group(a)
    const gb = group(b)
    if (ga !== gb) return ga - gb
    if (ga === 1) return 0
    const da = daysUntil(a.deadline!)
    const db = daysUntil(b.deadline!)
    return ga === 0 ? da - db : db - da
  })
}

/** 近期节点：未来 7 天内 + 已过期未完结的投递节点（Offer/暂告段落不再提醒） */
function UpcomingNodes({
  applications,
  onDetail,
}: {
  applications: ApplicationRecord[]
  onDetail: (c: Company) => void
}) {
  const nodes = applications
    .filter((a) => a.deadline && a.status !== "Offer" && a.status !== "暂告段落")
    .map((a) => ({ app: a, d: daysUntil(a.deadline!) }))
    .filter(({ d }) => d <= 7)
    .sort((x, y) => {
      // 今天 → 未来升序 → 已过期（最近过期在前）
      const gx = x.d >= 0 ? 0 : 1
      const gy = y.d >= 0 ? 0 : 1
      if (gx !== gy) return gx - gy
      return gx === 0 ? x.d - y.d : y.d - x.d
    })
    .slice(0, 6)

  if (nodes.length === 0) return null

  return (
    <section
      aria-label="近期节点提醒"
      className="mb-5 rounded-lg border border-border bg-card px-4 py-3 sm:px-5"
    >
      <div className="flex items-center gap-3">
        <h2 className="font-display shrink-0 text-[15px] font-bold tracking-wide text-foreground">近期节点</h2>
        <span aria-hidden className="h-px flex-1 bg-border/60" />
        <span className="shrink-0 text-[11.5px] font-medium tabular-nums text-muted-foreground">
          {nodes.length} 个待跟进
        </span>
      </div>
      <ul className="scroll-thin mt-1.5 max-h-56 overflow-y-auto">
        {nodes.map(({ app, d }) => {
          const urgent = d >= 0 && d <= 3
          const expired = d < 0
          return (
            <li key={app.id} className="border-b border-border/50 last:border-b-0">
              <button
                onClick={() => app.company && onDetail(app.company)}
                className="group flex w-full items-center gap-3 rounded-md px-1 py-2 text-left transition-colors hover:bg-secondary/50"
              >
                <CompanyAvatar
                  name={app.company?.name ?? ""}
                  className="size-7 shrink-0 rounded-[5px] text-[11.5px]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{app.company?.name}</span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">{app.position}</span>
                </span>
                <span className="hidden shrink-0 items-center gap-1 text-[11.5px] text-foreground/75 sm:flex">
                  <span aria-hidden className={cn("size-1.5 rounded-full", STATUS_DOT[app.status])} />
                  {app.status}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-2 py-px text-[11px] font-medium tabular-nums",
                    expired
                      ? "border-border bg-secondary/60 text-muted-foreground/85"
                      : urgent
                        ? "border-[#a06b3f]/45 bg-[#f7ece1] text-[#8a4f28] dark:border-[#b07b4a]/50 dark:bg-[#382a1c] dark:text-[#e2b58c]"
                        : d <= 7
                          ? "border-primary/25 bg-accent text-accent-foreground/90"
                          : "border-border/80 bg-card text-muted-foreground/85"
                  )}
                >
                  {expired ? `已过 ${Math.abs(d)} 天` : d === 0 ? "今天到期" : d <= 7 ? `剩 ${d} 天` : dateLabel(toShanghaiDateStr(app.deadline!))}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** 跨企业最近动态：合并所有投递的流转轨迹，按时间倒序，点击直达详情 */
function RecentActivity({
  applications,
  onDetail,
}: {
  applications: ApplicationRecord[]
  onDetail: (c: Company) => void
}) {
  // 展平 → 升序计算「从什么状态变到什么状态」→ 倒序展示（最新在上）
  const entries = applications
    .flatMap((a) => a.history.map((h) => ({ ...h, app: a })))
    .sort((x, y) => x.at.localeCompare(y.at))
    .map((e, i, arr) => ({
      ...e,
      from: i > 0 && arr[i - 1].app.id === e.app.id ? arr[i - 1].status : null,
    }))
    .reverse()
    .slice(0, 12)

  if (entries.length === 0) return null

  return (
    <section
      aria-label="投递最近动态"
      className="mt-5 rounded-lg border border-border bg-card px-4 py-3 sm:px-5"
    >
      <div className="flex items-center gap-3">
        <h2 className="font-display shrink-0 text-[15px] font-bold tracking-wide text-foreground">最近动态</h2>
        <span aria-hidden className="h-px flex-1 bg-border/60" />
        <span className="shrink-0 text-[11.5px] font-medium tabular-nums text-muted-foreground">最新在上</span>
      </div>
      <ol className="mt-1.5">
        {entries.map((e, i) => {
          const day = toShanghaiDateStr(e.at)
          const first = i === 0
          const last = i === entries.length - 1
          const isNew = e.from === null
          return (
            <li key={`${e.app.id}-${e.at}-${i}`} className="relative">
              <button
                onClick={() => e.app.company && onDetail(e.app.company)}
                className="group flex w-full items-center gap-3 rounded-md px-1 py-2 text-left transition-colors hover:bg-secondary/50"
              >
                {/* 时间轴轴点与连线 */}
                <span aria-hidden className="flex h-full flex-col items-center self-stretch">
                  <span
                    className={cn(
                      "mt-[7px] size-1.5 shrink-0 rounded-full",
                      STATUS_DOT[e.status] ?? "bg-stone-400",
                      !first && "opacity-55"
                    )}
                  />
                  {!last && <span className="my-0.5 w-px flex-1 bg-border/70" />}
                </span>
                <CompanyAvatar
                  name={e.app.company?.name ?? ""}
                  className="size-7 shrink-0 rounded-[5px] text-[11.5px]"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="truncate text-[13px] font-semibold">{e.app.company?.name}</span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">
                      {isNew ? (
                        <>
                          新增记录 · <span className="text-foreground/75">{e.status}</span>
                        </>
                      ) : (
                        <>
                          <span className="opacity-85">{e.from}</span>
                          <span aria-hidden className="mx-0.5 opacity-65">→</span>
                          <span className="font-medium text-foreground/85">{e.status}</span>
                        </>
                      )}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">{e.app.position}</span>
                </span>
                <span className="hidden shrink-0 text-[11px] tabular-nums text-muted-foreground sm:block">
                  {dateLabel(day)}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <p className="mt-1 border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
        展示最近 12 条流转动态，点任意一条查看该企业详情与完整轨迹
      </p>
    </section>
  )
}

/** 看板卡片：列内实体与拖拽幽灵共用 */
function KanbanCard({
  app,
  overlay = false,
  onDetail,
  onAskDelete,
  onStatusChange,
}: {
  app: ApplicationRecord
  overlay?: boolean
  onDetail?: (c: Company) => void
  onAskDelete?: (a: ApplicationRecord) => void
  onStatusChange?: (app: ApplicationRecord, status: string) => void
}) {
  const ddl = deadlineBadge(app.deadline)
  // 已过期的记录：整体降饱和弱化，不再与进行中的事项竞争注意力
  const expired = !!app.deadline && daysUntil(app.deadline) < 0
  return (
    <article
      className={cn(
        "rounded-lg border bg-card p-3",
        expired
          ? "border-border/70 bg-card/70"
          : "border-border",
        overlay
          ? "shadow-[0_10px_30px_rgba(32,29,25,0.16)] ring-1 ring-primary/35 dark:shadow-[0_12px_32px_rgba(0,0,0,0.55)] dark:ring-[#7ba98f]/45"
          : "transition-shadow duration-200 hover:shadow-[0_1px_6px_rgba(32,29,25,0.07)] dark:hover:shadow-[0_1px_8px_rgba(0,0,0,0.4)]"
      )}
    >
      <div className="flex items-start gap-2.5">
        <CompanyAvatar name={app.company?.name ?? ""} className="size-8 rounded-[6px] text-[13px]" />
        <button
          className="min-w-0 flex-1 text-left"
          onClick={() => !overlay && app.company && onDetail?.(app.company)}
          tabIndex={overlay ? -1 : undefined}
        >
          <h3 className="font-display truncate text-[14.5px] font-bold tracking-wide">
            {app.company?.name}
          </h3>
          <p className="truncate text-[12px] text-foreground/75">{app.position}</p>
        </button>
        {!overlay && onAskDelete && (
          <button
            onClick={() => onAskDelete(app)}
            aria-label="删除该记录"
            className="flex size-5 items-center justify-center rounded text-muted-foreground/70 opacity-0 transition-[opacity,background-color,color] duration-200 hover:bg-secondary hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
          >
            <X className="size-3.5" strokeWidth={1.6} />
          </button>
        )}
      </div>

      {app.notes && (
        <p className="mt-2 line-clamp-2 rounded-[4px] bg-secondary/60 px-2 py-1.5 text-[11.5px] leading-relaxed text-foreground/80">
          {app.notes}
        </p>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        {ddl && (
          <span
            className={cn(
              "shrink-0 rounded-full border px-1.5 text-[11px] leading-4 font-medium tabular-nums",
              ddl.cls
            )}
          >
            {ddl.text}
          </span>
        )}
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {dateLabel(toShanghaiDateStr(app.updatedAt))}
        </span>
        {!overlay && onStatusChange && (
          <Select value={app.status} onValueChange={(v) => onStatusChange(app, v)}>
            <SelectTrigger
              className="ml-auto h-6.5 w-auto gap-1 rounded-md border-border/80 px-2 text-[12px] text-foreground/85"
              aria-label="切换阶段"
            >
              {app.status}
            </SelectTrigger>
            <SelectContent className="rounded-md">
              {STATUS_ORDER.map((s) => (
                <SelectItem key={s} value={s} className="text-[12.5px]">
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </article>
  )
}

// Select 的 onValueChange 类型与 dnd listeners 的 onPointerDown 冲突需绕开：拖拽监听只绑在卡片外层 div，Select 在内部且 stopPropagation 不需要（activationConstraint distance 6 会区分点击/拖拽）

/** 单列看板容器（droppable） */
function KanbanColumn({
  status,
  list,
  children,
}: {
  status: string
  list: ApplicationRecord[]
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` })
  return (
    <section
      aria-label={`阶段：${status}，${list.length} 条记录`}
      className="flex w-[76vw] min-w-[250px] max-w-[300px] shrink-0 snap-start flex-col sm:w-auto sm:flex-1"
    >
      <div className="flex items-center gap-2 px-1 pb-2.5">
        <span aria-hidden className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
        <h2 className="font-display text-[14.5px] font-bold tracking-wide text-foreground">{status}</h2>
        <span
          className={cn(
            "ml-auto rounded-full px-2 text-[11px] leading-4 font-semibold tabular-nums",
            list.length > 0 ? "bg-secondary/90 text-foreground/80" : "text-muted-foreground/80"
          )}
        >
          {list.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-2.5 rounded-lg p-2 transition-[background-color,box-shadow] duration-150",
          isOver
            ? "bg-secondary/75 shadow-[inset_0_0_0_1.5px_rgba(30,75,58,0.35)] dark:bg-secondary/70 dark:shadow-[inset_0_0_0_1.5px_rgba(123,169,143,0.45)]"
            : "bg-secondary/40"
        )}
      >
        {children}
      </div>
    </section>
  )
}

/** 可拖拽包装器 */
function DraggableCard({
  app,
  children,
}: {
  app: ApplicationRecord
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: app.id,
    data: { status: app.status },
  })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "group cursor-grab touch-none active:cursor-grabbing",
        isDragging && "opacity-35 [border-style:dashed]"
      )}
    >
      {children}
    </div>
  )
}

/** 投递看板：六阶段看板（拖拽改阶段）+ 日历模式 + DDL 倒计时 + 搜索过滤 + CSV 导出 */
export function TrackerView({
  applications,
  loading,
  filter,
  onFilter,
  onDetail,
  onStatusChange,
  onDelete,
  onGoDirectory,
  onGoDeadlines,
}: {
  applications: ApplicationRecord[] | null
  loading: boolean
  filter: string
  onFilter: (v: string) => void
  onDetail: (c: Company) => void
  onStatusChange: (app: ApplicationRecord, status: string) => void
  onDelete: (app: ApplicationRecord) => void
  onGoDirectory: () => void
  onGoDeadlines: () => void
}) {
  const [pendingDelete, setPendingDelete] = useState<ApplicationRecord | null>(null)
  const [dragging, setDragging] = useState<ApplicationRecord | null>(null)

  const rawTotal = applications?.length ?? 0

  // 搜索过滤：企业名 / 岗位 / 笔记 / 行业（客户端即时过滤，数据量为百级）
  const list = useMemo(() => {
    const all = applications ?? []
    const kw = filter.trim().toLowerCase()
    if (!kw) return all
    return all.filter(
      (a) =>
        (a.company?.name ?? "").toLowerCase().includes(kw) ||
        a.position.toLowerCase().includes(kw) ||
        (a.notes ?? "").toLowerCase().includes(kw) ||
        (a.company?.industry ?? "").includes(kw)
    )
  }, [applications, filter])

  // 桌面：位移 6px 启动拖拽；触屏：长按 220ms 启动（不干扰横向滚动）
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } })
  )

  function findApp(id: string) {
    return (applications ?? []).find((a) => a.id === id) ?? null
  }

  function onDragStart(e: DragStartEvent) {
    setDragging(findApp(String(e.active.id)))
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null)
    const over = e.over
    if (!over) return
    const app = findApp(String(e.active.id))
    if (!app) return
    // 目标：列（col:xx）或列内卡片
    let target: string | null = null
    const overId = String(over.id)
    if (overId.startsWith("col:")) target = overId.slice(4)
    else {
      const overApp = findApp(overId)
      target = overApp?.status ?? (over.data.current?.status as string | undefined) ?? null
    }
    if (!target || target === app.status) return
    onStatusChange(app, target)
  }

  function exportCsv() {
    if (!applications?.length) return
    const header = ["企业", "行业", "岗位", "阶段", "渠道", "截止日", "备注", "最近更新", "招聘官网"]
    const rows = applications.map((a) => [
      a.company?.name ?? "",
      a.company?.industry ?? "",
      a.position,
      a.status,
      a.channel ?? "",
      a.deadline ? toShanghaiDateStr(a.deadline) : "",
      (a.notes ?? "").replace(/\n/g, " "),
      dateLabel(toShanghaiDateStr(a.updatedAt)),
      a.company?.recruitUrl ?? "",
    ])
    const csv =
      "\uFEFF" +
      [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "饭来·投递记录.csv"
    a.click()
    URL.revokeObjectURL(url)
    toast.success("已导出 CSV，可直接用表格软件打开")
  }

  const total = list.length
  const byStatus = list.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1
    return acc
  }, {})
  const companyCount = new Set(list.map((a) => a.companyId)).size
  const activeCount = total - (byStatus["Offer"] ?? 0) - (byStatus["暂告段落"] ?? 0)
  const distSegments = STATUS_ORDER.map((s) => ({ status: s, count: byStatus[s] ?? 0 })).filter((s) => s.count > 0)
  // 氛围横幅小字：未来 7 天内到期的进行中节点数（Offer/暂告段落不再提醒）
  const weekDdl = (applications ?? []).filter((a) => {
    if (!a.deadline || a.status === "Offer" || a.status === "暂告段落") return false
    const d = daysUntil(a.deadline)
    return d >= 0 && d <= 7
  }).length

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-foreground/15 pb-8 pt-10 sm:pb-10 sm:pt-14">
        <div>
          <p className="kicker text-[10.5px] text-[color:var(--teal)]">Application Board</p>
          <h1 className="font-display mt-2.5 flex items-baseline gap-3 text-[30px] font-bold tracking-wide sm:text-[36px]">
            <span aria-hidden className="section-no text-[28px] font-semibold sm:text-[32px]">02</span>
            投递看板
          </h1>
          <p className="mt-2.5 max-w-lg text-[13px] leading-relaxed text-muted-foreground">
            拖动卡片即可流转阶段，也可以用下拉切换；全市场公司的网申截止时间在「投递日历」按日排布。
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2.5">
          {/* 截止时间已由「投递日历」专职负责，这里只留一个轻量入口 */}
          <Button
            variant="outline"
            className="h-9 shrink-0 rounded-md text-[12.5px]"
            onClick={onGoDeadlines}
          >
            <CalendarClock className="mr-1.5 size-4" strokeWidth={1.6} />
            截止日历
          </Button>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/80"
              strokeWidth={1.6}
            />
            <input
              type="text"
              value={filter}
              onChange={(e) => onFilter(e.target.value)}
              placeholder="筛选企业、岗位或笔记…"
              aria-label="筛选投递记录"
              className="h-9 w-full rounded-md border border-border bg-card pl-8 pr-8 text-[12.5px] placeholder:text-muted-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:w-60"
            />
            {filter && (
              <button
                type="button"
                onClick={() => onFilter("")}
                aria-label="清除筛选"
                className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground/80 transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="size-3.5" strokeWidth={1.6} />
              </button>
            )}
          </div>
          <Button
            variant="outline"
            className="h-9 shrink-0 rounded-md text-[12.5px]"
            onClick={exportCsv}
            disabled={rawTotal === 0}
          >
            <Download className="mr-1.5 size-4" strokeWidth={1.6} />
            导出 CSV
          </Button>
        </div>
      </div>

      {/* 蓝绿氛围横幅：看板的性格页——每一个节点都值得被认真对待 */}
      <ViewBanner
        src="/images/banner-teal.jpg"
        alt="夜空极光氛围横幅"
        title="每一个节点，都算数"
        note={weekDdl > 0 ? `未来 7 天 · ${weekDdl} 个节点到期` : "未来 7 天 · 暂无到期节点"}
        tone="teal"
        priority
        className="mt-6 h-40 sm:h-44"
      />

      {loading && !applications ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-lg bg-secondary/60" />
          ))}
        </div>
      ) : rawTotal === 0 ? (
        <div className="relative flex flex-col items-center gap-3 overflow-hidden rounded-lg border border-dashed border-border py-16 text-center">
          {/* 空态底景：晨光小径——还没开始走，路已经亮着 */}
          <Image
            src="/images/scenery-forest-path.png"
            alt=""
            fill
            sizes="(max-width: 1024px) 100vw, 900px"
            className="pointer-events-none absolute inset-0 object-cover opacity-[0.13] dark:opacity-[0.1]"
          />
          <div className="relative flex flex-col items-center gap-3">
            <Inbox className="size-8 text-muted-foreground/70" strokeWidth={1.2} />
            <p className="font-display text-[16px] text-foreground/80">还没有任何投递记录</p>
            <p className="max-w-sm text-[13px] leading-relaxed text-muted-foreground">
              在今日名录或企业名录里看到心动企业，点「记一笔投递」即可开始跟踪进度
            </p>
            <Button variant="outline" className="mt-1 h-9 rounded-md text-[13px]" onClick={onGoDirectory}>
              去企业名录逛逛
            </Button>
          </div>
        </div>
      ) : total === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-14 text-center">
          <Search className="size-7 text-muted-foreground/35" strokeWidth={1.2} />
          <p className="font-display text-[15.5px] text-foreground/80">没有匹配「{filter.trim()}」的记录</p>
          <p className="text-[12.5px] text-muted-foreground">
            可以按企业名、岗位、笔记或行业筛选，试试其他关键词
          </p>
          <Button variant="ghost" className="mt-1 h-8 rounded-md text-[12.5px]" onClick={() => onFilter("")}>
            清除筛选
          </Button>
        </div>
      ) : (
        <>
          {/* 投递总览：状态分布比例条 + 图例，一眼看出漏斗形状 */}
          <section
            aria-label="投递总览"
            className="mb-5 rounded-lg border border-border bg-card px-4 py-3 sm:px-5"
          >
            <div className="flex items-center gap-3">
              <h2 className="font-display shrink-0 text-[15px] font-bold tracking-wide text-foreground">投递总览</h2>
              <span aria-hidden className="h-px flex-1 bg-border/60" />
              <span className="shrink-0 text-[11.5px] font-medium tabular-nums text-muted-foreground">
                {filter.trim()
                  ? `筛出 ${total} / ${rawTotal} 条`
                  : `${total} 条记录 · ${companyCount} 家企业 · 进行中 ${activeCount}`}
              </span>
            </div>
            <div
              role="img"
              aria-label={`投递状态分布，共 ${total} 条记录：${distSegments.map((s) => `${s.status} ${s.count}`).join("，")}`}
              className="mt-2.5 flex h-1.5 gap-px overflow-hidden rounded-full bg-secondary/70"
            >
              {distSegments.map(({ status, count }) => (
                <span
                  key={status}
                  style={{ flexGrow: count, minWidth: 8 }}
                  className={cn("h-full", STATUS_DOT[status])}
                />
              ))}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
              {distSegments.map(({ status, count }) => (
                <span
                  key={status}
                  className="flex items-center gap-1.5 text-[12px] text-muted-foreground"
                >
                  <span aria-hidden className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
                  {status}
                  <span className="tabular-nums font-semibold text-foreground/85">{count}</span>
                </span>
              ))}
            </div>
          </section>

          <UpcomingNodes applications={list} onDetail={onDetail} />
          <DndContext
            sensors={sensors}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => setDragging(null)}
          >
            <div className="scroll-thin -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
              {STATUS_ORDER.map((status) => {
                const columnList = sortByDeadline(list.filter((a) => a.status === status))
                return (
                  <KanbanColumn key={status} status={status} list={columnList}>
                    {columnList.length === 0 ? (
                      <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border/90 px-3 py-6">
                        <p className="text-[11.5px] tracking-wide text-muted-foreground">这一步还没有记录</p>
                      </div>
                    ) : (
                      columnList.map((a) => (
                        <DraggableCard key={a.id} app={a}>
                          <KanbanCard
                            app={a}
                            onDetail={onDetail}
                            onAskDelete={setPendingDelete}
                            onStatusChange={onStatusChange}
                          />
                        </DraggableCard>
                      ))
                    )}
                  </KanbanColumn>
                )
              })}
            </div>

            <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0.4, 1)" }}>
              {dragging ? (
                <div className="w-[260px]">
                  <KanbanCard app={dragging} overlay />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>

          <RecentActivity applications={list} onDetail={onDetail} />
        </>
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent className="rounded-lg sm:max-w-[400px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-base tracking-wide">
              删除「{pendingDelete?.company?.name}」的投递记录？
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[12.5px]">
              该企业的记录将从看板移除。名录中的企业不会受影响，之后可以重新记录。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-md text-[13px]">保留</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-md bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (pendingDelete) onDelete(pendingDelete)
                setPendingDelete(null)
              }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
