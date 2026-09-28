"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown, ClipboardList, Eye, LayoutGrid, Plus, Rows3, Search, Star, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { FOCUS_INDUSTRIES, INDUSTRIES, INDUSTRY_COVER, type Industry } from "@/lib/catalog"
import type { Company, CompaniesResponse, Season } from "@/lib/types"
import { seasonMeta } from "@/lib/season"
import { ViewBanner } from "./view-banner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { CompanyRow } from "./company-row"
import { CompanyCard } from "./company-card"
import { Bowl } from "./bowl"

export type DirIndustry = string

/** 每个行业一句欢迎语（横幅右上角招牌句，8~14 字）；未收录行业走通用兜底 */
const INDUSTRY_WELCOME: Record<Industry, string> = {
  科技零售: "欢迎来零售一线看看",
  智能制造: "欢迎走进智造车间",
  消费电子: "欢迎来做下一代设备",
  智能硬件: "欢迎来做有趣的硬件",
  供应链与物流: "欢迎加入物流大动脉",
  进出口贸易: "欢迎来看世界的货",
  医疗健康: "欢迎守护每一种健康",
  实业与新能源: "欢迎来点亮新能源",
  互联网与软件: "欢迎来写下一行代码",
  汽车与出行: "欢迎同赴出行新时代",
  消费品与快消: "欢迎把好物带给市场",
  金融与银行: "欢迎来经手大资金",
  教育与培训: "欢迎站上三尺讲台",
  文化与传媒: "欢迎来讲更好的故事",
  法律与专业服务: "欢迎加入专业主义",
  地产与建筑: "欢迎来筑一座新城",
  国企与公用事业: "欢迎来国家队报到",
  酒旅与航空: "欢迎去看更大世界",
}

export function DirectoryView({
  q,
  onQ,
  industries,
  onToggleIndustry,
  onClearIndustries,
  starredOnly,
  onStarredOnly,
  hasAppOnly,
  onHasAppOnly,
  includeHidden,
  onIncludeHidden,
  sort,
  onSort,
  data,
  loading,
  onLoadMore,
  viewMode,
  onViewMode,
  onDetail,
  onApply,
  onStar,
  onAddCompany,
  season,
}: {
  q: string
  onQ: (v: string) => void
  industries: DirIndustry[]
  onToggleIndustry: (v: DirIndustry) => void
  onClearIndustries: () => void
  starredOnly: boolean
  onStarredOnly: (v: boolean) => void
  hasAppOnly: boolean
  onHasAppOnly: (v: boolean) => void
  includeHidden: boolean
  onIncludeHidden: (v: boolean) => void
  sort: string
  onSort: (v: string) => void
  data: CompaniesResponse | null
  loading: boolean
  onLoadMore: () => void
  viewMode: "list" | "grid"
  onViewMode: (v: "list" | "grid") => void
  onDetail: (c: Company) => void
  onApply: (c: Company) => void
  onStar: (c: Company) => void
  onAddCompany: () => void
  season: Season
}) {
  const [qDraft, setQDraft] = useState(q)
  const meta = seasonMeta(season)
  const items = data?.items ?? []
  const shownCount = (data?.page ?? 1) * (data?.pageSize ?? 24)
  const total = data?.total ?? 0

  const focusIndustries = FOCUS_INDUSTRIES
  const restIndustries = INDUSTRIES.filter((i) => !FOCUS_INDUSTRIES.includes(i))

  // 实时搜索：输入停頦 450ms 后自动应用；Enter 立即生效；外部清空（如「清除搜索」）同步回输入框
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (qDraft.trim() === q) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onQ(qDraft.trim()), 450)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [qDraft])
  useEffect(() => {
    setQDraft(q)
  }, [q])

  function submitSearch() {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    onQ(qDraft.trim())
  }

  const hasDraft = qDraft.length > 0
  const multiSelect = industries.length > 0
  // 只选中单个行业时，页头下方展示该行业的横幅大图卡（多选/全部不显示）
  const bannerIndustry =
    industries.length === 1 && (INDUSTRIES as readonly string[]).includes(industries[0])
      ? (industries[0] as Industry)
      : null

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-foreground/15 pb-8 pt-10 sm:pb-10 sm:pt-14">
        <div>
          <p className="kicker text-[10.5px] text-[color:var(--sky)]">Company Directory · {meta.en}</p>
          <h1 className="font-display mt-2.5 flex items-baseline gap-3 text-[30px] font-bold tracking-wide sm:text-[36px]">
            <span aria-hidden className="section-no text-[28px] font-semibold sm:text-[32px]">01</span>
            {season}企业名录
          </h1>
          <p className="mt-2.5 max-w-lg text-[13.5px] leading-relaxed text-muted-foreground">
            {meta.directoryWord}全量企业库，覆盖你的优先赛道与各行各业。口径宽，慢慢挑：先扫一遍简介，感兴趣的先进官网再进名录。
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={onAddCompany}
            className="flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-[11.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            title="名录漏了某家企业？手动补充录入"
          >
            <Plus className="size-3.5" strokeWidth={1.6} />
            补充企业
          </button>
          <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
            <button
              onClick={() => onViewMode("list")}
              aria-label="切换为列表视图"
              aria-pressed={viewMode === "list"}
              className={cn(
                "flex size-7 items-center justify-center rounded-[4px] transition-colors",
                viewMode === "list" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Rows3 className="size-4" strokeWidth={1.6} />
            </button>
          <button
            onClick={() => onViewMode("grid")}
            aria-label="切换为卡片视图"
            aria-pressed={viewMode === "grid"}
            className={cn(
              "flex size-7 items-center justify-center rounded-[4px] transition-colors",
              viewMode === "grid" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <LayoutGrid className="size-4" strokeWidth={1.6} />
          </button>
          </div>
        </div>
      </div>

      {/* 单行业横幅：选中单个行业时，用该行业封面插画开一幅小画报（多选/全部不渲染） */}
      {bannerIndustry && (
        <ViewBanner
          src={INDUSTRY_COVER[bannerIndustry]}
          alt={`${bannerIndustry}行业封面插画`}
          title={bannerIndustry}
          badge={INDUSTRY_WELCOME[bannerIndustry] ?? `欢迎报考${bannerIndustry}`}
          note={`当前筛出 ${total} 家${q ? " · 含关键词过滤" : ""}`}
          tone="dark"
          priority
          className="mt-6 h-44 sm:h-52"
        />
      )}

      {/* 工具栏 */}
      <div className="sticky top-16 z-30 -mx-4 border-y border-border/70 bg-background/85 px-4 py-3 backdrop-blur-lg transition-[background-color,border-color] duration-200 sm:mx-0 sm:rounded-lg sm:border sm:px-4 sm:shadow-[0_1px_3px_rgba(32,29,25,0.04)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/80" strokeWidth={1.6} />
            <Input
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitSearch()}
              aria-label="搜索企业、岗位方向或城市"
              placeholder="搜索企业、岗位方向、城市…"
              className="h-9 rounded-md border-input bg-card pl-9 pr-8 text-[13px]"
            />
            {hasDraft && (
              <button
                onClick={() => {
                  if (debounceRef.current) clearTimeout(debounceRef.current)
                  setQDraft("")
                  onQ("")
                }}
                aria-label="清除搜索关键词"
                title="清除搜索"
                className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground/75 transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="size-3.5" strokeWidth={1.6} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
            <div className="flex items-center gap-2">
              <Switch
                id="starred-only"
                checked={starredOnly}
                onCheckedChange={onStarredOnly}
                className="data-[state=checked]:bg-primary"
              />
              <Label htmlFor="starred-only" className="flex cursor-pointer items-center gap-1 text-[12.5px] text-muted-foreground">
                <Star className="size-3.5" strokeWidth={1.6} />
                仅看星标
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="has-app-only"
                checked={hasAppOnly}
                onCheckedChange={onHasAppOnly}
                className="data-[state=checked]:bg-primary"
              />
              <Label htmlFor="has-app-only" className="flex cursor-pointer items-center gap-1 text-[12.5px] text-muted-foreground">
                <ClipboardList className="size-3.5" strokeWidth={1.6} />
                有投递记录
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="include-hidden"
                checked={includeHidden}
                onCheckedChange={onIncludeHidden}
                className="data-[state=checked]:bg-primary"
              />
              <Label htmlFor="include-hidden" className="flex cursor-pointer items-center gap-1 text-[12.5px] text-muted-foreground">
                <Eye className="size-3.5" strokeWidth={1.6} />
                含已忽略
              </Label>
            </div>
            <div className="relative ml-auto">
              <select
                value={sort}
                onChange={(e) => onSort(e.target.value)}
                aria-label="排序方式"
                className="h-9 appearance-none rounded-md border border-input bg-card pl-3 pr-8 text-[12.5px] text-foreground/80 outline-none transition-colors hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <option value="newest">最新放出优先</option>
                <option value="oldest">最早放出优先</option>
                <option value="deadline">截止日最近优先</option>
                <option value="name">按企业名称</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/80" strokeWidth={1.6} />
            </div>
          </div>
        </div>
      </div>

      {/* 行业分类：上下分栏平铺（第一组＝全部 + 优先赛道，第二组＝更多行业），不再横向滑动；
          分类区不 sticky（占两行高度，钉住会吃掉大半屏），列表长时回到顶部切换即可。
          整组垫一块毛玻璃面板：选项文字在海浪背景上保持可读（Task 28-c） */}
      <div className="mt-3.5 space-y-2 rounded-lg border border-border/50 bg-card/60 px-3 py-2.5 backdrop-blur-md" role="group" aria-label="按行业筛选">
        <div className="flex flex-wrap items-center gap-1.5">
          <span aria-hidden className="w-12 shrink-0 select-none text-[10.5px] leading-5 tracking-wide text-muted-foreground/75">
            优先赛道
          </span>
          <Chip active={!multiSelect} onClick={onClearIndustries}>全部</Chip>
          {focusIndustries.map((ind) => (
            <Chip
              key={ind}
              active={industries.includes(ind)}
              onClick={() => onToggleIndustry(ind)}
              focus
              ariaLabel={industries.includes(ind) ? `取消筛选${ind}` : `同时筛选${ind}`}
            >
              {ind}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span aria-hidden className="w-12 shrink-0 select-none text-[10.5px] leading-5 tracking-wide text-muted-foreground/75">
            更多行业
          </span>
          {restIndustries.map((ind) => (
            <Chip
              key={ind}
              active={industries.includes(ind)}
              onClick={() => onToggleIndustry(ind)}
              ariaLabel={industries.includes(ind) ? `取消筛选${ind}` : `同时筛选${ind}`}
            >
              {ind}
            </Chip>
          ))}
        </div>
        {multiSelect && (
          <div className="flex items-center gap-2 px-0.5 pt-0.5">
            <p className="text-[11px] tabular-nums text-muted-foreground/80" aria-live="polite">
              已同时筛选 <span className="font-medium text-foreground/85">{industries.length}</span> 个行业：{industries.join(" · ")}
            </p>
            <button
              onClick={onClearIndustries}
              className="shrink-0 text-[11px] text-primary underline-offset-2 transition-colors hover:underline"
            >
              清空行业筛选
            </button>
          </div>
        )}
      </div>

      {/* 结果计数（毛玻璃垫底，防海浪背景吃字） */}
      <div className="mt-2.5 flex items-center justify-between rounded-md bg-card/50 px-3 py-2 text-[12px] tabular-nums text-muted-foreground backdrop-blur-sm">
        <span>
          共收录 <span className="font-medium text-foreground">{total}</span> 家
          {multiSelect ? " · 多行业并集" : " · 优先赛道已排前"}
        </span>
        {q && (
          <button onClick={() => { setQDraft(""); onQ("") }} className="text-[12px] text-primary hover:underline">
            清除搜索「{q}」
          </button>
        )}
      </div>

      {/* 结果区 */}
      {loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
          <Bowl mood="sad" size={52} />
          <p className="font-display text-[15px] text-foreground/70">没翻到合口味的店</p>
          <p className="max-w-xs text-[12.5px] leading-relaxed text-muted-foreground">换个关键词，或放宽行业筛选试试</p>
        </div>
      ) : viewMode === "list" ? (
        <div className="rounded-lg border border-border bg-card">
          {items.map((c) => (
            <CompanyRow key={c.id} company={c} onDetail={onDetail} onApply={onApply} onStar={onStar} />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((c) => (
            <CompanyCard key={c.id} company={c} onDetail={onDetail} onStar={onStar} />
          ))}
        </div>
      )}

      {data?.hasMore && (
        <div className="mt-6 flex justify-center">
          <Button
            variant="outline"
            className="h-10 rounded-md px-6 text-[13px] tabular-nums"
            onClick={onLoadMore}
            disabled={loading}
          >
            {loading ? "加载中…" : `查看更多（已显示 ${Math.min(shownCount, total)} / ${total}）`}
          </Button>
        </div>
      )}
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
  focus,
  ariaLabel,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  focus?: boolean
  ariaLabel?: string
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[11.5px] leading-5 transition-colors sm:px-3 sm:py-1 sm:text-[12px]",
        active
          ? "border-primary bg-primary text-primary-foreground"
          // 半透明毛玻璃底：海浪视频从选项下透出但不干扰文字（Task 28-c）
          : "border-border/60 bg-card/70 text-muted-foreground/90 backdrop-blur-sm hover:border-foreground/25 hover:text-foreground",
        focus && !active && "border-[color:var(--sky)]/35 text-foreground/70"
      )}
    >
      {/* 优先赛道专属小圆点（名录声部＝天蓝），未选中时展示 */}
      {focus && !active && <span aria-hidden className="mr-1.5 size-1.5 rounded-full bg-[color:var(--sky)]" />}
      {children}
    </button>
  )
}
