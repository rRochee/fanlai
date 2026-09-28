"use client"

import { Moon, Search, Sun } from "lucide-react"
import { motion } from "framer-motion"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"
import { dateLabel, weekdayLabel } from "@/lib/date"
import { SEASONS, type Season } from "@/lib/types"
import { FanLaiLogo } from "./logo"

export type Tab = "today" | "directory" | "tracker" | "deadlines" | "shortlist" | "insights"

/**
 * 六大功能各配一个专属声部色（用户点名的色系）：
 * 今日饭来=绯红（每日开饭的锣）、企业名录=天蓝（检索的入口）、
 * 投递看板=蓝绿（推进的节奏）、投递日历=琥珀（紧迫的刻度）、
 * 我的清单=淡蓝（私藏的抽屉）、求职洞察=墨蓝（复盘的深度）。
 * 导航激活态即「杂志栏目签」：整颗胶囊染上该栏目的声部色，一眼分清功能。
 */
export const TAB_COLOR: Record<Tab, string> = {
  today: "var(--crimson)",
  directory: "var(--sky)",
  tracker: "var(--teal)",
  deadlines: "var(--amber)",
  shortlist: "var(--powder)",
  insights: "var(--primary)",
}

const TABS: { key: Tab; label: string; short: string; hint: string }[] = [
  { key: "today", label: "今日饭来", short: "今日", hint: "每日送达的当季名录" },
  { key: "directory", label: "企业名录", short: "名录", hint: "全量检索当季企业" },
  { key: "tracker", label: "投递看板", short: "看板", hint: "管理你的投递进度" },
  { key: "deadlines", label: "投递日历", short: "日历", hint: "网申截止按日排布" },
  { key: "shortlist", label: "我的清单", short: "清单", hint: "星标企业一页式跟进" },
  { key: "insights", label: "求职洞察", short: "洞察", hint: "投递漏斗与节奏复盘" },
]

/** 亮暗切换：图标交由 .dark 类纯 CSS 切换，无水合闪烁 */
function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="切换亮色 / 暗色模式"
      title="切换亮 / 暗"
      className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:text-foreground sm:size-8"
    >
      <Sun aria-hidden className="hidden size-4 dark:block" strokeWidth={1.6} />
      <Moon aria-hidden className="size-4 dark:hidden" strokeWidth={1.6} />
    </button>
  )
}

export function SiteHeader({
  tab,
  onTab,
  season,
  onSeason,
  today,
  appliedCount,
  starredCount,
  onSearch,
}: {
  tab: Tab
  onTab: (t: Tab) => void
  season: Season
  onSeason: (s: Season) => void
  today: string
  appliedCount: number
  starredCount: number
  onSearch: () => void
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-4 sm:px-6">
        {/* 品牌：offer 飞进碗里的 Logo 徽章 */}
        <button
          onClick={() => onTab("today")}
          className="group flex shrink-0 items-center gap-2.5 text-left transition-opacity hover:opacity-85"
          aria-label="回到今日饭来"
          title="饭来！工作到我碗里来"
        >
          <FanLaiLogo
            size={40}
            animated
            className="shadow-hard-sm rounded-[9px] transition-transform duration-300 group-hover:-rotate-6 group-active:scale-90"
          />
          <span className="hidden min-[430px]:flex flex-col justify-center">
            <span className="font-display text-[21px] font-black leading-tight tracking-wide">饭来</span>
            <span className="kicker text-[10px] font-semibold leading-tight text-muted-foreground">FanLai Daily</span>
          </span>
        </button>

        <span className="mx-1 hidden h-6 w-px bg-border sm:block" />

        {/* 导航（移动端由底部 Tabbar 接管）：激活 tab 染上栏目专属色 */}
        <nav
          className="no-scrollbar -mx-1 hidden flex-1 items-center gap-1 overflow-x-auto px-1 sm:flex sm:gap-1.5"
          aria-label="主导航"
        >
          {TABS.map((t) => {
            const active = tab === t.key
            const color = TAB_COLOR[t.key]
            return (
              <button
                key={t.key}
                onClick={() => onTab(t.key)}
                title={t.hint}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative shrink-0 rounded-md px-2.5 py-2 text-[15px] font-medium transition-all sm:px-3.5 sm:text-[16px]",
                  active ? "font-bold text-white" : "text-foreground/80 hover:bg-secondary hover:text-foreground"
                )}
                style={active ? { backgroundColor: color } : undefined}
              >
                <span className="relative z-10 flex items-center gap-1.5">
                  {/* 声部色点：未激活也常驻，五个功能一眼分色 */}
                  <span
                    aria-hidden
                    className={cn("size-[8px] shrink-0 rounded-[2.5px] transition-colors", active && "bg-white/90")}
                    style={!active ? { backgroundColor: color } : undefined}
                  />
                  <span className="sm:hidden">{t.short}</span>
                  <span className="hidden sm:inline">{t.label}</span>
                  {t.key === "tracker" && appliedCount > 0 && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-px text-[11px] font-semibold leading-4 tabular-nums",
                        active ? "bg-white/25 text-white" : "bg-secondary text-muted-foreground"
                      )}
                    >
                      {appliedCount}
                    </span>
                  )}
                  {t.key === "shortlist" && starredCount > 0 && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-px text-[11px] font-semibold leading-4 tabular-nums",
                        active ? "bg-white/25 text-white" : "bg-secondary text-muted-foreground"
                      )}
                    >
                      {starredCount}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </nav>

        {/* 全局搜索入口（⌘K；触屏用户走名录内搜索） */}
        <button
          type="button"
          onClick={onSearch}
          aria-label="打开全局搜索，快捷键 Command K"
          className="hidden h-8 shrink-0 items-center gap-2 rounded-md border border-border bg-card pl-2.5 pr-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground md:flex"
        >
          <Search className="size-3.5" strokeWidth={1.6} />
          <span>搜索</span>
          <kbd className="rounded-[3px] border border-border/80 bg-secondary/70 px-1 font-sans text-[10px] font-normal leading-4 text-muted-foreground/80">
            ⌘K
          </kbd>
        </button>

        {/* 招聘季切换 + 亮暗切换 */}
        <div className="flex shrink-0 items-center gap-2">
          <div
            role="radiogroup"
            aria-label="切换招聘季"
            className="flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5"
          >
            {SEASONS.map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={season === s}
                title={`${s}模式：名录与今日推送将切换到${s}批次`}
                onClick={() => onSeason(s)}
                className={cn(
                  "rounded-[3px] px-1.5 py-1 text-[12px] leading-4 font-medium tracking-wide transition-colors sm:px-2.5 sm:text-[13px]",
                  season === s
                    ? "bg-primary font-bold text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="sm:hidden" aria-hidden>
                  {s.slice(0, 1)}
                </span>
                <span className="hidden sm:inline">{s}</span>
                <span className="sr-only">{s}</span>
              </button>
            ))}
          </div>
          <span className="relative flex">
            <ThemeToggle />
          </span>
        </div>

        {/* 日期 */}
        <div className="hidden text-right md:block">
          <div className="text-[14.5px] font-bold leading-tight tabular-nums">{dateLabel(today)}</div>
          <div className="text-[12px] leading-tight text-muted-foreground">{weekdayLabel(today)}</div>
        </div>
      </div>

      {/* 品牌四声部色带：红→天蓝→蓝绿→淡蓝，印在刊头顶边 */}
      <div aria-hidden className="flex h-[3px]">
        <span className="flex-1" style={{ background: "var(--crimson)" }} />
        <span className="flex-1" style={{ background: "var(--sky)" }} />
        <span className="flex-1" style={{ background: "var(--teal)" }} />
        <span className="flex-1" style={{ background: "var(--powder)" }} />
      </div>
    </header>
  )
}
