"use client"

import { useEffect, useRef, useState } from "react"
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion"
import { ChevronDown } from "lucide-react"
import type { Company, Season, Stats } from "@/lib/types"
import { dateLabel, weekdayLabel } from "@/lib/date"
import { seasonMeta, POSITIONING_POINTS } from "@/lib/season"
import { FanLaiLogo } from "./logo"

/**
 * 产品封面（Landing Cover）· v6 巨碗开饭刊头
 *   左半幅 = 一颗巨大的饭来 Logo（绯红小球垂直弹动落入碗中），
 *   衬一层随日光呼吸的柔光晕——海浪背景从半透明纸面下透出来；
 *   右半幅 = 杂志刊头：超大衬线「饭来」+ 纯功能简介（不写对比竞品）+
 *   三条功能主张（壹贰叁）+ 关键数字。
 * 动效清单：Logo 垂直落点、光晕呼吸、规线展开、数字滚动、要目跑马灯。
 * reduced-motion 全部静止。
 */

/** 数字滚动：SSR/首帧直接渲染最终值，挂载后从 0 平滑追赶；reduced-motion 不动 */
function CountNumber({ value, delay = 0 }: { value: number; delay?: number }) {
  const [display, setDisplay] = useState<number | null>(null)
  const reduce = useReducedMotion()

  useEffect(() => {
    if (reduce) return
    let raf = 0
    const timer = window.setTimeout(() => {
      const start = performance.now()
      const duration = 1150
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / duration)
        setDisplay(Math.round(value * (1 - Math.pow(1 - p, 3))))
        if (p < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }, delay)
    return () => {
      window.clearTimeout(timer)
      cancelAnimationFrame(raf)
    }
  }, [value, delay, reduce])

  return <>{display ?? value}</>
}

/** 从日期字符串算当年第几期（VOL.）：SSR/CSR 同一套纯函数，无 hydration 风险 */
function volumeOf(date?: string): string {
  if (!date) return ""
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ""
  const start = Date.UTC(d.getUTCFullYear(), 0, 1)
  const n = Math.floor((d.getTime() - start) / 86400000) + 1
  return String(n).padStart(3, "0")
}

/** 封面功能简介：只讲饭来自己做什么，不与任何竞品对比 */
const COVER_INTRO =
  "每天一份准时开饭的名录日报——只收当日新放出的招聘企业，先看企业、再挑岗位，记投递、盯截止，看完就能投。"

export function CoverHero({
  stats,
  companies,
  todayCount,
  season,
}: {
  stats: Stats | null
  companies: Company[] | null
  todayCount: number
  season: Season
}) {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] })
  const fade = useTransform(scrollYProgress, [0, 0.72], [1, 0.12])
  // 运镜随滚动再推一把：下滑时左幅轻沉，像镜头跟着人走
  const cineY = useTransform(scrollYProgress, [0, 1], ["0%", "8%"])

  const meta = seasonMeta(season)
  const today = stats?.today
  const total = stats?.total
  const marqueeNames = (companies ?? []).slice(0, 14).map((c) => c.name)
  const vol = volumeOf(today)

  return (
    <section
      ref={ref}
      aria-label="饭来产品封面"
      className="paper-light relative flex min-h-[100svh] flex-col overflow-hidden bg-[#f7f4ed] text-[#16335c] dark:bg-[#0a1c33] dark:text-[#e8eef8]"
    >
      {/* ── 左半幅：巨大的饭来 Logo（桌面 lg 分栏；移动端转为上方横幅） ── */}
      <motion.div
        style={reduce ? undefined : { y: cineY }}
        className="relative h-[40svh] w-full overflow-hidden lg:absolute lg:inset-y-0 lg:left-0 lg:h-auto lg:w-[46%]"
        aria-hidden
      >
        <div className="absolute inset-0 flex items-center justify-center">
          {/* 呼吸光晕：衬在巨碗背后，随日光轻缓明灭（Task 28-c：随 Logo 放大同步加大） */}
          {!reduce && <span className="logo-halo absolute left-1/2 top-1/2 size-[min(66vw,600px)] -translate-x-1/2 -translate-y-1/2 rounded-full" />}
          <motion.div
            initial={reduce ? false : { opacity: 0, scale: 0.86 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.1, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="relative"
          >
            <FanLaiLogo
              size={440}
              animated
              className="h-auto w-[min(60vw,330px)] drop-shadow-[0_10px_36px_rgba(22,51,92,0.16)] lg:w-[min(30vw,430px)] dark:drop-shadow-[0_10px_36px_rgba(2,10,24,0.5)]"
            />
          </motion.div>
        </div>
      </motion.div>

      {/* ── 右半幅：杂志刊头 ── */}
      <motion.div
        style={reduce ? undefined : { opacity: fade }}
        className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col px-5 sm:px-6 lg:ml-[46%] lg:max-w-3xl lg:pl-10"
      >
        {/* 刊号行：杂志框架——左刊名，右日期与期号 */}
        <motion.header
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.9, delay: 0.15 }}
          className="flex items-baseline justify-between gap-3 pb-3 pt-6 text-[10.5px] font-medium tracking-[0.34em] text-current/60 sm:pt-8 sm:text-[11.5px]"
        >
          <span className="shrink-0">FANLAI DAILY</span>
          <span className="hidden truncate tracking-[0.22em] sm:block">
            {meta.issueWord}企业名录 · 每日一份
          </span>
          <span className="shrink-0 tabular-nums tracking-[0.2em]">
            {today ? `${dateLabel(today)} ${weekdayLabel(today)}` : "整理中"}
            {vol && <span className="ml-2 text-current/45">VOL.{vol}</span>}
          </span>
        </motion.header>
        <motion.div
          initial={reduce ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 1.4, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="masthead-line h-px w-full origin-center bg-current opacity-20"
          aria-hidden
        />

        {/* 中央刊头 */}
        <div className="flex flex-1 flex-col justify-center py-10 sm:py-12">
          {/* 超大「饭来」：衬线粗宋刊头，字符错峰浮入 */}
          <h1 className="font-masthead mt-2 text-[clamp(4.4rem,17vw,8.6rem)] font-black leading-[1.04] tracking-[0.05em] sm:mt-4">
            <motion.span
              initial={reduce ? false : { opacity: 0, y: 38 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.85, delay: 0.55, ease: [0.22, 1, 0.36, 1] }}
              className="inline-block"
            >
              饭
            </motion.span>
            <motion.span
              initial={reduce ? false : { opacity: 0, y: 38 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.85, delay: 0.67, ease: [0.22, 1, 0.36, 1] }}
              className="inline-block"
            >
              来
            </motion.span>
          </h1>

          {/* 规线 + 英文小字 */}
          <motion.div
            initial={reduce ? false : { opacity: 0, scaleX: 0.6 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ duration: 0.7, delay: 0.88 }}
            className="mt-5 flex items-center gap-3 sm:mt-6"
            aria-hidden
          >
            <span className="h-px w-12 bg-current opacity-30 sm:w-16" />
            <span className="size-1 rounded-full bg-[color:var(--crimson)]" />
            <span className="h-px w-12 bg-current opacity-30 sm:w-16" />
          </motion.div>
          <motion.p
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.96 }}
            className="mt-3.5 text-[11.5px] font-medium tracking-[0.44em] text-current/60 sm:mt-4 sm:text-[12.5px]"
          >
            FANLAI · {meta.issueWord}企业名录日报
          </motion.p>

          {/* 功能简介：一句话讲清饭来每天做什么 */}
          <motion.p
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 1.06 }}
            className="mt-4 max-w-xl text-[14.5px] leading-relaxed text-current/85 sm:mt-5 sm:text-[16px]"
          >
            {COVER_INTRO}
          </motion.p>

          {/* 三条功能主张：杂志小栏（壹贰叁） */}
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 1.2 }}
            className="mt-7 grid max-w-xl gap-x-6 gap-y-3.5 sm:grid-cols-3"
            aria-label="饭来怎么用"
          >
            {POSITIONING_POINTS.map((p, i) => (
              <motion.div
                key={p.title}
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 1.3 + i * 0.12 }}
                className="border-l border-current/20 pl-3"
              >
                <p className="flex items-baseline gap-1.5 text-[13px] font-bold tracking-wide">
                  <span className="font-masthead text-[10.5px] font-bold text-[color:var(--crimson)]">{p.no}</span>
                  {p.title}
                </p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-current/60">{p.desc}</p>
              </motion.div>
            ))}
          </motion.div>

          {/* 关键数字：今日上新 / 累计收录 / 覆盖行业（点分隔，杂志风） */}
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 1.56 }}
            className="mt-8 flex items-center justify-start gap-3 text-[12px] tracking-[0.14em] text-current/65 sm:mt-9 sm:gap-4 sm:text-[13px]"
          >
            <span className="flex items-baseline gap-1.5">
              <span className="font-masthead text-[22px] font-black tabular-nums leading-none text-current sm:text-[26px]">
                {todayCount > 0 ? (
                  <>
                    <span className="align-top text-[0.6em]">+</span>
                    <CountNumber value={todayCount} delay={1750} />
                  </>
                ) : (
                  "—"
                )}
              </span>
              今日上新
            </span>
            <span className="size-1 rounded-full bg-current opacity-35" aria-hidden />
            <span className="flex items-baseline gap-1.5">
              <span className="font-masthead text-[22px] font-black tabular-nums leading-none text-current sm:text-[26px]">
                {total != null ? <CountNumber value={total} delay={1900} /> : "—"}
              </span>
              累计收录
            </span>
            <span className="size-1 rounded-full bg-current opacity-35" aria-hidden />
            <span className="flex items-baseline gap-1.5">
              <span className="font-masthead text-[22px] font-black leading-none text-current sm:text-[26px]">18</span>
              覆盖行业
            </span>
          </motion.div>
        </div>

        {/* 向下引导 */}
        <motion.button
          type="button"
          onClick={() => window.scrollBy({ top: Math.round(window.innerHeight * 0.8), behavior: "smooth" })}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 1.86 }}
          className="group mx-auto mb-8 flex flex-col items-center gap-1.5 text-current/70 transition-colors hover:text-current sm:mb-10"
          aria-label="向下滚动，查看今日名录"
        >
          <span className="text-[11px] tracking-[0.3em]">往下滑 · 看今日名录</span>
          <ChevronDown aria-hidden className="cover-arrow size-6" strokeWidth={1.6} />
        </motion.button>
      </motion.div>

      {/* 底部极轻跑马灯：今日送达的企业名单（本期要目），日期收在右端 */}
      <div className="relative z-10 border-t border-current/12 bg-black/[0.025] py-2.5 dark:bg-white/[0.04]">
        <div className="flex items-center overflow-hidden" aria-hidden>
          <span className="ml-4 mr-4 shrink-0 rounded-[3px] bg-[color:var(--crimson)] px-2 py-0.5 text-[10.5px] font-bold tracking-wider text-white sm:ml-6">
            本期要目
          </span>
          {marqueeNames.length > 0 ? (
            <div className="relative flex-1 overflow-hidden">
              <div className="marquee-track flex w-max items-center">
                {[0, 1].map((dup) => (
                  <div key={dup} className="flex shrink-0 items-center">
                    {marqueeNames.map((n, i) => (
                      <span key={`${dup}-${i}`} className="flex items-center text-[12px] text-current/65">
                        <span className="px-3.5">{n}</span>
                        <span className="size-1 rounded-full bg-current/25" />
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <span className="flex-1 text-[12px] text-current/45">今日名录正在开饭，稍后揭晓…</span>
          )}
          {today && (
            <span className="mr-4 hidden shrink-0 text-[10.5px] tabular-nums tracking-[0.18em] text-current/45 sm:mr-6 sm:block">
              {dateLabel(today)}
            </span>
          )}
        </div>
        <span className="sr-only">
          {marqueeNames.length > 0 ? `今日送达企业：${marqueeNames.join("、")}` : "今日名录整理中"}
        </span>
      </div>
    </section>
  )
}
