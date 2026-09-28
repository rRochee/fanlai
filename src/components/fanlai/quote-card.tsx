"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { RefreshCw } from "lucide-react"
import { QUOTES, quoteIndexForDay } from "@/lib/quotes"
import { cn } from "@/lib/utils"

/**
 * 今日一言 · 古籍哲理卡（Task 25-f / 26-k 升级）
 * 见缝插针心态注脚：一张暖纸色卡片，左侧配图随句轮换（真实风景 × 抽象水墨混排），
 * 右侧衬线经句 + 现代注解。
 * 26-k：不再一天一句钉死——起句按日轮换（SSR/CSR 一致），挂载后每 14 秒
 * 自动换下一句、配图同步交叉淡化；也可以点右下角的手动换一换。
 * prefers-reduced-motion：停止自动轮换，只保留手动切换。
 */

/** 配图池：真实风景 + 抽象图混排，按句下标轮换 */
const QUOTE_IMAGES = [
  "/images/abstract-ink-arc.png",
  "/images/scenery-lake-dawn.png",
  "/images/abstract-waves.png",
  "/images/scenery-forest-path.png",
  "/images/scenery-city-dawn.png",
  "/images/scenery-sea-sunrise.png",
  "/images/scenery-valley.jpg",
  "/images/hero-scenery.jpg",
] as const

const ROTATE_MS = 14_000

export function QuoteCard({ today, className }: { today?: string; className?: string }) {
  const reduce = useReducedMotion()
  // 起句：按日期固定（SSR/CSR 同值），挂载后才开始轮换
  const [index, setIndex] = useState(() => quoteIndexForDay(today))
  const [paused, setPaused] = useState(false)

  const next = () => setIndex((i) => (i + 1) % QUOTES.length)

  useEffect(() => {
    if (reduce || paused) return
    const timer = window.setInterval(next, ROTATE_MS)
    return () => window.clearInterval(timer)
  }, [reduce, paused])

  const q = QUOTES[index]
  const img = QUOTE_IMAGES[index % QUOTE_IMAGES.length]

  return (
    <motion.aside
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className={`overflow-hidden rounded-lg border border-border bg-[#f7f4ed] shadow-[0_1px_0_rgba(12,35,64,0.04)] dark:border-border dark:bg-[#0f2440] ${className ?? ""}`}
      aria-label="今日一言：古籍里的求职心态"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="grid sm:grid-cols-[200px_1fr] lg:grid-cols-[240px_1fr]">
        {/* 配图：随句轮换，交叉淡化 */}
        <div className="cover-img relative hidden min-h-[176px] sm:block" aria-hidden>
          <AnimatePresence initial={false}>
            <motion.div
              key={img}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 1.1, ease: "easeInOut" }}
              className="cover-img absolute inset-0"
            >
              <Image
                src={img}
                alt=""
                fill
                sizes="240px"
                className="art-img object-cover"
              />
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          {/* 卡头：栏目签 + 印章点 + 轮换进度点 */}
          <div className="flex items-center gap-2.5">
            <span className="kicker text-[10px] text-[color:var(--crimson)]">今日一言 · 稳住心神</span>
            <span aria-hidden className="h-px flex-1 bg-[#0c2340]/12 dark:bg-white/10" />
            <span aria-hidden className="flex items-center gap-1">
              {[0, 1, 2, 3, 4].map((n) => {
                const dot = (index + n + QUOTES.length - 2) % QUOTES.length
                return (
                  <span
                    key={n}
                    className={cn(
                      "size-1 rounded-full transition-colors",
                      n === 2 ? "bg-[color:var(--crimson)]" : "bg-[#0c2340]/18 dark:bg-white/20"
                    )}
                    aria-hidden
                    data-dot={dot}
                  />
                )
              })}
            </span>
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-[color:var(--crimson)]"
            />
          </div>

          {/* 经句：衬线大字，随轮换淡入 */}
          <div className="relative mt-3.5 min-h-[92px] sm:min-h-[100px]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.blockquote
                key={index}
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -8 }}
                transition={{ duration: reduce ? 0 : 0.55, ease: [0.22, 1, 0.36, 1] }}
                className="font-masthead absolute inset-0 text-[19px] font-black leading-[1.5] tracking-[0.015em] sm:text-[21px]"
              >
                「{q.text}」
                <span className="mt-2.5 block font-sans text-[11px] font-normal tracking-[0.18em] text-muted-foreground">
                  —— {q.from}
                </span>
              </motion.blockquote>
            </AnimatePresence>
          </div>

          {/* 注解 */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={`note-${index}`}
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.5 }}
              className="mt-2 max-w-lg border-l-2 border-[color:var(--crimson)]/45 pl-3 text-[13px] leading-relaxed text-foreground/75"
            >
              {q.note}
            </motion.p>
          </AnimatePresence>

          {/* 手动换一句：不等定时器也能翻页 */}
          <button
            type="button"
            onClick={next}
            aria-label="换一句"
            className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-full border border-border/80 bg-card/80 px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            <RefreshCw className="size-3" strokeWidth={1.7} />
            换一句
          </button>
        </div>
      </div>
    </motion.aside>
  )
}
