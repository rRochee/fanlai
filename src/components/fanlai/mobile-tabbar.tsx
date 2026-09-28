"use client"

import { CalendarClock, ChartNoAxesColumn, KanbanSquare, LayoutGrid, Newspaper, Star } from "lucide-react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import type { Tab } from "./site-header"
import { TAB_COLOR } from "./site-header"

const ITEMS: { key: Tab; label: string; icon: typeof Newspaper }[] = [
  { key: "today", label: "今日", icon: Newspaper },
  { key: "directory", label: "名录", icon: LayoutGrid },
  { key: "tracker", label: "看板", icon: KanbanSquare },
  { key: "deadlines", label: "日历", icon: CalendarClock },
  { key: "shortlist", label: "清单", icon: Star },
  { key: "insights", label: "洞察", icon: ChartNoAxesColumn },
]

/** 移动端底部导航：与顶栏同一套「声部色」系统——激活 tab 染上栏目专属色，拇指也能一眼分清功能 */
export function MobileTabbar({
  tab,
  onTab,
  appliedCount,
  starredCount,
}: {
  tab: Tab
  onTab: (t: Tab) => void
  appliedCount: number
  starredCount: number
}) {
  return (
    <nav
      aria-label="底部导航"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-background/90 backdrop-blur-md sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-md items-stretch">
        {ITEMS.map(({ key, label, icon: Icon }) => {
          const active = tab === key
          const badge = key === "tracker" ? appliedCount : key === "shortlist" ? starredCount : 0
          return (
            <button
              key={key}
              type="button"
              onClick={() => onTab(key)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex flex-1 flex-col items-center gap-0.5 px-0.5 pb-2 pt-2.5 text-[10.5px] transition-colors",
                active ? "font-semibold" : "text-muted-foreground"
              )}
              style={active ? { color: TAB_COLOR[key] } : undefined}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute top-0 h-[2.5px] w-7 rounded-full transition-opacity",
                  active ? "opacity-100" : "opacity-0"
                )}
                style={{ background: TAB_COLOR[key] }}
              />
              <motion.span
                className="relative"
                animate={{ y: active ? -2 : 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 26 }}
              >
                <Icon
                  className={cn("size-[19px]")}
                  style={active ? { color: TAB_COLOR[key] } : undefined}
                  strokeWidth={active ? 2 : 1.6}
                />
                {badge > 0 && (
                  <span
                    aria-hidden
                    className="absolute -right-2 -top-1 min-w-[14px] rounded-full bg-accent px-1 text-center text-[8.5px] font-medium leading-[14px] tabular-nums text-accent-foreground"
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </motion.span>
              <span className="tracking-wide">{label}</span>
              {active && <span className="sr-only">（当前视图）</span>}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
