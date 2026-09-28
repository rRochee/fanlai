"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { toast } from "sonner"
import {
  ArrowDownWideNarrow,
  ArrowRight,
  Building2,
  CalendarDays,
  CalendarPlus,
  ChartNoAxesColumn,
  DatabaseBackup,
  ListTodo,
  Moon,
  Newspaper,
  RefreshCcw,
  Search,
  Star,
  Sun,
} from "lucide-react"
import { api, SEASONS, STATUS_DOT, type Company, type Season } from "@/lib/types"
import { exportBackup } from "@/lib/backup-client"
import { cn } from "@/lib/utils"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import type { Tab } from "./site-header"
import { CompanyAvatar } from "./company-avatar"

const NAV_ITEMS: { key: Tab; label: string; hint: string; kbd: string; Icon: typeof Newspaper }[] = [
  { key: "today", label: "今日饭来", hint: "每日送达的当季名录", kbd: "1", Icon: Newspaper },
  { key: "directory", label: "企业名录", hint: "全量检索当季企业", kbd: "2", Icon: Building2 },
  { key: "tracker", label: "投递看板", hint: "管理投递进度", kbd: "3", Icon: ListTodo },
  { key: "deadlines", label: "投递日历", hint: "网申截止按日排布", kbd: "4", Icon: CalendarDays },
  { key: "shortlist", label: "我的清单", hint: "星标企业一页式跟进", kbd: "5", Icon: Star },
  { key: "insights", label: "求职洞察", hint: "投递漏斗与节奏复盘", kbd: "6", Icon: ChartNoAxesColumn },
]

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-[3px] border border-border/80 bg-secondary/60 px-1 font-sans text-[10px] font-normal leading-4 text-muted-foreground/80">
      {children}
    </kbd>
  )
}

/** 全局命令面板（⌘K）：搜企业直达详情并可就地星标/记投递、跳转视图、同步情报、备份 */
export function CommandPalette({
  open,
  onOpenChange,
  onGoTab,
  onOpenCompany,
  onOpenApply,
  onDataChanged,
  onSync,
  onSearchInDirectory,
  onOpenCalendar,
  onDirectoryDeadlineSort,
  season,
  onSeason,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGoTab: (t: Tab) => void
  onOpenCompany: (c: Company) => void
  onOpenApply: (c: Company) => void
  onDataChanged: () => void
  onSync: () => void
  onSearchInDirectory: (q: string) => void
  onOpenCalendar: () => void
  onDirectoryDeadlineSort: () => void
  season: Season
  onSeason: (s: Season) => void
}) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Company[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [starring, setStarring] = useState<string | null>(null)
  const { resolvedTheme, setTheme } = useTheme()

  // 关闭时清空搜索词，下次打开回到干净的起始态
  useEffect(() => {
    if (!open) {
      setQuery("")
      setResults(null)
      setSearching(false)
    }
  }, [open])

  // 企业搜索：220ms 防抖走 /api/companies（服务端覆盖名称/简介/岗位/城市/行业）
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) {
      setResults(null)
      setSearching(false)
      return
    }
    let alive = true
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const sp = new URLSearchParams({ q, pageSize: "8", sort: "newest" })
        const res = await api<{ items: Company[] }>(`/api/companies?${sp.toString()}`)
        if (alive) setResults(res.items)
      } catch {
        if (alive) setResults([])
      } finally {
        if (alive) setSearching(false)
      }
    }, 220)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [query, open])

  const q = query.trim()
  const showCompanyGroup = q.length > 0
  const dark = resolvedTheme === "dark"

  const run = (fn: () => void) => {
    onOpenChange(false)
    fn()
  }

  // 就地星标：不关闭面板，行内图标即时翻转，全局数据 bump 由父层处理
  async function toggleStar(c: Company) {
    if (starring) return
    setStarring(c.id)
    // 乐观更新，失败回滚
    setResults((rs) => rs?.map((r) => (r.id === c.id ? { ...r, starred: !r.starred } : r)) ?? rs)
    try {
      await api<Company>(`/api/companies/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({ starred: !c.starred }),
      })
      toast.success(c.starred ? `已取消「${c.name}」的星标` : `已将「${c.name}」加入星标`)
      onDataChanged()
    } catch (e) {
      setResults((rs) => rs?.map((r) => (r.id === c.id ? { ...r, starred: c.starred } : r)) ?? rs)
      toast.error((e as Error).message)
    } finally {
      setStarring(null)
    }
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      shouldFilter={false}
      title="全局搜索"
      description="搜索企业，或跳转到任意视图"
      showCloseButton={false}
      className="overflow-hidden rounded-xl border-border/80 p-0 shadow-[0_24px_70px_-20px_rgba(32,29,25,0.30)] dark:shadow-[0_28px_80px_-20px_rgba(0,0,0,0.75)] sm:top-[15%] sm:max-w-[580px] sm:translate-y-0"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="搜索企业、岗位、城市，或跳转视图…"
        className="h-11 text-[13.5px]"
      />
      <CommandList className="scroll-thin max-h-[360px] px-1 py-1.5">
        <CommandEmpty>
          {searching ? (
            <span className="text-[12.5px] text-muted-foreground">正在搜索「{q}」…</span>
          ) : (
            <span className="text-[12.5px] text-muted-foreground">没有匹配「{q}」的结果</span>
          )}
        </CommandEmpty>

        {showCompanyGroup && (
          <CommandGroup
            heading="企业"
            className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:tracking-[0.16em]"
          >
            {searching && (
              <div className="px-2.5 py-3 text-[12px] text-muted-foreground/80">正在搜索「{q}」…</div>
            )}
            {!searching && results?.length === 0 && (
              <div className="px-2.5 py-3 text-[12px] leading-relaxed text-muted-foreground/80">
                没有匹配「{q}」的企业，也可以去名录里按岗位方向搜
              </div>
            )}
            {results?.map((c) => (
              <CommandItem
                key={c.id}
                value={c.id}
                onSelect={() => run(() => onOpenCompany(c))}
                className="rounded-md"
              >
                <CompanyAvatar name={c.name} className="size-6 shrink-0 rounded-[5px] text-[10.5px]" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium">{c.name}</span>
                    {!c.verified && (
                      <span className="shrink-0 rounded-full border border-[color:var(--crimson)]/40 bg-[color:var(--crimson-soft)] px-1.5 text-[10px] leading-4 text-[color:var(--crimson-deep)]">
                        待核
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {c.industry} · {c.city}
                    {c.application ? ` · ${c.application.status}` : ""}
                  </span>
                </span>
                {/* 行内快捷动作：星标就地翻转（不关面板）；记投递关面板开弹窗 */}
                <span
                  className="flex shrink-0 items-center gap-0.5"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    title={c.starred ? "取消星标" : "加入星标"}
                    aria-label={c.starred ? `取消「${c.name}」星标` : `将「${c.name}」加入星标`}
                    disabled={starring === c.id}
                    onClick={() => toggleStar(c)}
                    className={cn(
                      "flex size-6 items-center justify-center rounded-md transition-colors",
                      c.starred
                        ? "text-primary hover:bg-accent"
                        : "text-muted-foreground/70 hover:bg-secondary hover:text-foreground"
                    )}
                  >
                    <Star className={cn("size-3.5", c.starred && "fill-primary")} strokeWidth={1.6} />
                  </button>
                  <button
                    type="button"
                    title="记一笔投递"
                    aria-label={`为「${c.name}」记投递`}
                    onClick={() => run(() => onOpenApply(c))}
                    className="flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <CalendarPlus className="size-3.5" strokeWidth={1.6} />
                  </button>
                </span>
                {c.application && (
                  <span
                    aria-hidden
                    className={cn("mr-1 size-1.5 shrink-0 rounded-full", STATUS_DOT[c.application.status] ?? "bg-stone-400")}
                  />
                )}
              </CommandItem>
            ))}
            {!searching && (
              <CommandItem
                value={`__directory__${q}`}
                onSelect={() => run(() => onSearchInDirectory(q))}
                className="rounded-md"
              >
                <Search className="size-4 shrink-0 opacity-60" strokeWidth={1.6} />
                <span className="flex-1 truncate text-[12.5px]">
                  在企业名录中搜索「<span className="text-foreground/85">{q}</span>」
                </span>
                <ArrowRight className="size-3.5 shrink-0 opacity-50" strokeWidth={1.6} />
              </CommandItem>
            )}
          </CommandGroup>
        )}

        {showCompanyGroup && <CommandSeparator className="-mx-1" />}

        <CommandGroup
          heading="快捷操作"
          className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:tracking-[0.16em]"
        >
          <CommandItem value="action-sync" onSelect={() => run(onSync)} className="rounded-md">
            <RefreshCcw className="size-4 shrink-0 opacity-60" strokeWidth={1.6} />
            <span className="min-w-0 flex-1">
              <span className="text-[13px]">同步今日情报</span>
              <span className="ml-2 hidden text-[11px] text-muted-foreground/70 sm:inline">
                搜索最新{season}动态并入库
              </span>
            </span>
          </CommandItem>
          <CommandItem
            value="action-backup"
            onSelect={() => run(() => exportBackup())}
            className="rounded-md"
          >
            <DatabaseBackup className="size-4 shrink-0 opacity-60" strokeWidth={1.6} />
            <span className="min-w-0 flex-1">
              <span className="text-[13px]">导出数据备份</span>
              <span className="ml-2 hidden text-[11px] text-muted-foreground/70 sm:inline">
                全量 JSON 下载到本地
              </span>
            </span>
          </CommandItem>
        </CommandGroup>

        <CommandGroup
          heading="前往"
          className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:tracking-[0.16em]"
        >
          {NAV_ITEMS.map(({ key, label, hint, kbd, Icon }) => (
            <CommandItem key={key} value={`nav-${key}`} onSelect={() => run(() => onGoTab(key))} className="rounded-md">
              <Icon className="size-4 shrink-0 opacity-60" strokeWidth={1.6} />
              <span className="min-w-0 flex-1">
                <span className="text-[13px]">{label}</span>
                <span className="ml-2 hidden text-[11px] text-muted-foreground/70 sm:inline">{hint}</span>
              </span>
              <CommandShortcut className="text-[10.5px] tracking-normal">
                <Kbd>{kbd}</Kbd>
              </CommandShortcut>
            </CommandItem>
          ))}
          <CommandItem value="nav-calendar" onSelect={() => run(onOpenCalendar)} className="rounded-md">
            <CalendarDays className="size-4 shrink-0 opacity-60" strokeWidth={1.6} />
            <span className="min-w-0 flex-1">
              <span className="text-[13px]">看板日历模式</span>
              <span className="ml-2 hidden text-[11px] text-muted-foreground/70 sm:inline">按月查看截止节点与批次放出</span>
            </span>
          </CommandItem>
          <CommandItem value="nav-deadline" onSelect={() => run(onDirectoryDeadlineSort)} className="rounded-md">
            <ArrowDownWideNarrow className="size-4 shrink-0 opacity-60" strokeWidth={1.6} />
            <span className="min-w-0 flex-1">
              <span className="text-[13px]">名录按截止日排序</span>
              <span className="ml-2 hidden text-[11px] text-muted-foreground/70 sm:inline">快到期的企业排最前</span>
            </span>
          </CommandItem>
        </CommandGroup>

        <CommandGroup
          heading="切换"
          className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:tracking-[0.16em]"
        >
          {SEASONS.filter((s) => s !== season).map((s) => (
            <CommandItem key={s} value={`season-${s}`} onSelect={() => run(() => onSeason(s))} className="rounded-md">
              <RefreshCcw className="size-4 shrink-0 opacity-60" strokeWidth={1.6} />
              <span className="text-[13px]">
                切换到<span className="text-foreground/85">{s}</span>模式
              </span>
              <span className="ml-2 hidden text-[11px] text-muted-foreground/70 sm:inline">
                名录与推送随季切换
              </span>
            </CommandItem>
          ))}
          <CommandItem
            value="toggle-theme"
            onSelect={() => run(() => setTheme(dark ? "light" : "dark"))}
            className="rounded-md"
          >
            {dark ? (
              <Sun className="size-4 shrink-0 opacity-60" strokeWidth={1.6} />
            ) : (
              <Moon className="size-4 shrink-0 opacity-60" strokeWidth={1.6} />
            )}
            <span className="text-[13px]">切换到{dark ? "亮色" : "暗色"}模式</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>

      <div className="flex items-center gap-3 border-t border-border/70 px-3.5 py-2 text-[10.5px] text-muted-foreground/80">
        <span className="flex items-center gap-1">
          <Kbd>↑↓</Kbd> 选择
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> 打开
        </span>
        <span className="flex items-center gap-1">
          <Kbd>esc</Kbd> 关闭
        </span>
        <span className="ml-auto hidden items-center gap-1 sm:flex">
          <Kbd>1-5</Kbd> 切换视图
        </span>
      </div>
    </CommandDialog>
  )
}
