"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { HeartHandshake, Lock, Send } from "lucide-react"
import { cn } from "@/lib/utils"
import { dateLabel, toShanghaiDateStr } from "@/lib/date"

/**
 * 树洞 · 只说给碗听（Task 28-e）
 * 纯本地备忘录：只写给自己——localStorage 存储（key "fanlai-treehole"），不建社群、不上传。
 * · 输入：280 字上限 + 心情四选一（焦虑/期待/平静/疲惫）+ 保存（≥40px 触达）
 * · 列表：倒序卡片，删除需二次确认（inline 两步，4 秒未确认自动复位）
 * · 隐私承诺：「仅存在于此设备，不会上传」写在明面上
 * · SSR 安全：localStorage 一律挂载后读；reduced-motion 无碍（只淡入）
 */

const STORE_KEY = "fanlai-treehole"
const MAX_LEN = 280
const KEEP_MAX = 50 // 本地最多保留最近 50 条

interface HoleEntry {
  id: string
  text: string
  mood: MoodKey
  createdAt: string
}

type MoodKey = "焦虑" | "期待" | "平静" | "疲惫"

const MOODS: { key: MoodKey; dot: string }[] = [
  { key: "焦虑", dot: "var(--crimson)" },
  { key: "期待", dot: "var(--powder)" },
  { key: "平静", dot: "var(--teal)" },
  { key: "疲惫", dot: "var(--sky)" },
]

function moodDot(mood: MoodKey): string {
  return MOODS.find((m) => m.key === mood)?.dot ?? "var(--teal)"
}

/** 本地时间戳展示：今天带时刻，昨天/更早只落到日 */
function timeLabel(iso: string, today: string): string {
  const day = toShanghaiDateStr(iso)
  if (day === today) {
    const t = new Date(iso)
    return `今天 ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`
  }
  return dateLabel(day)
}

function loadEntries(): HoleEntry[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((e): e is HoleEntry => !!e && typeof (e as HoleEntry).text === "string" && typeof (e as HoleEntry).createdAt === "string")
      .map((e) => ({
        id: typeof e.id === "string" ? e.id : `th_${Math.random().toString(36).slice(2)}`,
        text: e.text,
        mood: MOODS.some((m) => m.key === e.mood) ? e.mood : "平静",
        createdAt: e.createdAt,
      }))
  } catch {
    return []
  }
}

function saveEntries(entries: HoleEntry[]) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(entries.slice(0, KEEP_MAX)))
  } catch {
    /* 隐私模式等写入失败：静默，不承诺云同步 */
  }
}

export function TreeHole({ today, className }: { today: string; className?: string }) {
  const reduce = useReducedMotion()
  const [mounted, setMounted] = useState(false)
  const [entries, setEntries] = useState<HoleEntry[]>([])
  const [text, setText] = useState("")
  const [mood, setMood] = useState<MoodKey | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const confirmTimer = useRef<number | null>(null)

  // SSR 安全：localStorage 只在挂载后读（异步一跳，避开 effect 内同步 setState 的级联渲染）
  useEffect(() => {
    const hydrate = window.setTimeout(() => {
      setMounted(true)
      setEntries(loadEntries())
    }, 0)
    return () => {
      window.clearTimeout(hydrate)
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current)
    }
  }, [])

  const canSave = text.trim().length > 0 && mood !== null

  function handleSave() {
    if (!canSave) return
    const entry: HoleEntry = {
      id: `th_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      text: text.trim().slice(0, MAX_LEN),
      mood: mood!,
      createdAt: new Date().toISOString(),
    }
    const next = [entry, ...entries].slice(0, KEEP_MAX)
    setEntries(next)
    saveEntries(next)
    setText("")
    setMood(null)
  }

  function askDelete(id: string) {
    // 二次确认：第一次点变「确认删除」，4 秒未确认自动复位
    if (confirmingId === id) {
      const next = entries.filter((e) => e.id !== id)
      setEntries(next)
      saveEntries(next)
      setConfirmingId(null)
      return
    }
    setConfirmingId(id)
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current)
    confirmTimer.current = window.setTimeout(() => setConfirmingId(null), 4000)
  }

  return (
    <motion.section
      aria-label="树洞备忘录：只说给碗听"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className={cn("relative overflow-hidden rounded-lg border border-border bg-card", className)}
    >
      <div className="px-4 pb-5 pt-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="kicker shrink-0 text-[12px] text-[color:var(--crimson)]">树洞 · 只说给碗听</h2>
          <span aria-hidden className="h-px min-w-6 flex-1 bg-border/70" />
          <span className="t-data flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground/80">
            <Lock className="size-3" strokeWidth={1.7} aria-hidden />
            仅存在于此设备，不会上传
          </span>
        </div>
        <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-muted-foreground">
          有些话不必发出去，也该有个去处。写进树洞，碗替你收着——没人看见，除了你自己。
        </p>

        {/* 输入区 */}
        <div className="mt-4 rounded-lg border border-border/80 bg-secondary/30 p-3.5">
          <label htmlFor="treehole-input" className="sr-only">
            写给树洞的话
          </label>
          <textarea
            id="treehole-input"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
            placeholder="今天的委屈、明天的期待、说不出口的疲惫……"
            rows={3}
            maxLength={MAX_LEN}
            className="w-full resize-none rounded-md border border-border/70 bg-card px-3 py-2.5 text-[13.5px] leading-relaxed placeholder:text-muted-foreground/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-muted-foreground/75">心情：</span>
            <div role="radiogroup" aria-label="选择心情" className="flex flex-wrap items-center gap-1.5">
              {MOODS.map((m) => {
                const active = mood === m.key
                return (
                  <button
                    key={m.key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setMood(active ? null : m.key)}
                    className={cn(
                      "flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors",
                      active
                        ? "border-foreground/35 bg-card font-medium text-foreground"
                        : "border-border/80 bg-card/60 text-muted-foreground hover:border-foreground/25 hover:text-foreground"
                    )}
                  >
                    <span aria-hidden className="size-1.5 rounded-full" style={{ background: m.dot }} />
                    {m.key}
                  </button>
                )
              })}
            </div>
            <span className={cn("t-data ml-auto text-[12px]", text.length >= MAX_LEN ? "text-[color:var(--crimson)]" : "text-muted-foreground/80")}>
              {text.length}/{MAX_LEN}
            </span>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className={cn(
              "mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-md text-[14px] font-semibold transition-colors sm:w-44",
              canSave
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "cursor-not-allowed bg-secondary/70 text-muted-foreground/80"
            )}
            title={mood === null ? "先选一个心情，再交给碗" : "存进树洞"}
          >
            <Send className="size-3.5" strokeWidth={1.8} aria-hidden />
            交给碗存着
          </button>
        </div>

        {/* 列表：倒序卡片 */}
        {mounted && entries.length > 0 && (
          <ul className="mt-4 space-y-2.5">
            <AnimatePresence initial={false}>
              {entries.slice(0, 20).map((e) => (
                <motion.li
                  key={e.id}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  className="group rounded-md border border-border/70 bg-card px-3.5 py-3"
                >
                  <div className="flex items-center gap-2">
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: moodDot(e.mood) }} />
                    <span className="text-[12px] font-semibold text-foreground/80">{e.mood}</span>
                    <span className="t-data text-[12px] text-muted-foreground/80">{timeLabel(e.createdAt, today)}</span>
                    <button
                      type="button"
                      onClick={() => askDelete(e.id)}
                      className={cn(
                        "ml-auto rounded px-2 py-1 text-[12px] transition-colors",
                        confirmingId === e.id
                          ? "bg-destructive/10 font-semibold text-destructive"
                          : "text-muted-foreground/70 opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
                      )}
                    >
                      {confirmingId === e.id ? "再点一次确认删除" : "删除"}
                    </button>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-foreground/85">{e.text}</p>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
        {mounted && entries.length === 0 && (
          <div className="mt-4 flex flex-col items-center gap-1.5 rounded-md border border-dashed border-border/80 px-4 py-8 text-center">
            <HeartHandshake className="size-6 text-muted-foreground/35" strokeWidth={1.2} aria-hidden />
            <p className="font-display text-[14px] text-foreground/70">写下来，碗都替你接着</p>
            <p className="text-[12px] text-muted-foreground/70">只存 50 条最近的话，删了就真的没有了</p>
          </div>
        )}

        {/* 引导：呼应「不建社群」的产品决定 */}
        <p className="mt-4 border-t border-border/60 pt-3 text-[12px] leading-relaxed text-muted-foreground/70">
          想被更多同路人听见？把你的心声发到任何平台，带上{" "}
          <span className="font-semibold text-foreground/80">#饭来bot</span>{" "}
          ——我们不做社群，但愿你被听见。
        </p>
      </div>
    </motion.section>
  )
}
