"use client"

import { useRef, useState } from "react"
import Image from "next/image"
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion"
import { cn } from "@/lib/utils"
import { FanLaiLogo } from "./logo"

/**
 * 三步开饭 · 滚动叙事层
 * 回答用户最重要的两个问题：这东西怎么用？有什么用？
 * 桌面端左栏 sticky（刊头大标 + 步骤指示），右侧三张步骤卡随滚动依次登场，
 * 滚动进度驱动左栏步骤高亮；结尾是一块墨蓝大色块的品牌宣言。
 * 移动端降级为顺序堆叠卡片（sticky 侧栏隐藏），配合 whileInView 渐入。
 */

const STEPS = [
  {
    no: "01",
    color: "var(--crimson)",
    soft: "var(--crimson-soft)",
    title: "每天准时开饭",
    en: "DAILY SERVE",
    desc: "每天早上，当日新放出的当季企业自动送达。不限行业、不限规模——全量收录，而不是只挑几家熟悉的。你的优先赛道置顶呈现，其余各行各业一并奉上。",
    points: ["今日及之前批次随时回看", "每家附简介与信息来源", "AI 新情报先入「待核」，人工确认后才算数"],
    // 迷你示意：批次轴
    art: (
      <div className="flex items-center gap-1.5" aria-hidden>
        {["8/28", "8/29", "8/30", "8/31", "今日"].map((d, i) => (
          <span
            key={d}
            className={cn(
              "flex h-9 min-w-[46px] flex-col items-center justify-center rounded-md border text-[10px] leading-tight",
              i === 4 ? "border-transparent text-white" : "border-border bg-background text-muted-foreground"
            )}
            style={i === 4 ? { background: "var(--crimson)" } : undefined}
          >
            <span className="font-medium">{d}</span>
            <span className="tabular-nums opacity-80">{9 + i} 家</span>
          </span>
        ))}
      </div>
    ),
  },
  {
    no: "02",
    color: "var(--sky)",
    soft: "var(--sky-soft)",
    title: "先看企业，再挑岗位",
    en: "COMPANY FIRST",
    desc: "点开任何一家：简介、热招方向、城市与规模一目了然，一键直达招聘官网。先判断这家值不值得投，再谈具体岗位——这是找工作的正确顺序。",
    points: ["简介、热招方向、融资与规模", "直达企业招聘官网", "行业筛选 + 全局搜索 ⌘K"],
    // 迷你示意：企业行
    art: (
      <div className="w-full max-w-[300px] rounded-md border border-border bg-background p-2.5" aria-hidden>
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-[5px] text-[11px] font-bold text-white" style={{ background: "var(--sky)" }}>
            鲜
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-semibold">鲜丰水果 · 科技零售</p>
            <p className="truncate text-[10px] text-muted-foreground">管培生 / 供应链专员 · 杭州</p>
          </div>
          <span className="rounded-[3px] px-1.5 py-0.5 text-[8.5px] font-medium text-white" style={{ background: "var(--crimson)" }}>
            官网 ›
          </span>
        </div>
      </div>
    ),
  },
  {
    no: "03",
    color: "var(--teal)",
    soft: "var(--teal-soft)",
    title: "把工作记进碗里",
    en: "KEEP THE BOWL FULL",
    desc: "星标意向、记下每一笔投递，看板陪你从「意向中」一路走到「Offer」。哪几家快到截止日、这一周该推进谁，一眼看清——饭，一碗一碗端稳。",
    points: ["投递状态六阶段流转", "日历视图盯紧截止日", "投递漏斗复盘节奏"],
    // 迷你示意：看板三列
    art: (
      <div className="flex items-stretch gap-1.5" aria-hidden>
        {[
          { s: "已投递", n: 6, c: "var(--powder)" },
          { s: "面试中", n: 3, c: "var(--teal)" },
          { s: "Offer", n: 1, c: "var(--crimson)" },
        ].map((col) => (
          <div key={col.s} className="w-[86px] rounded-md border border-border bg-background p-1.5">
            <p className="flex items-center gap-1 text-[10px] font-medium">
              <span className="size-1.5 rounded-[2px]" style={{ background: col.c }} />
              {col.s}
            </p>
            <div className="mt-1 space-y-1">
              {Array.from({ length: col.n }).map((_, i) => (
                <div key={i} className="h-4 rounded-[3px] bg-secondary" />
              ))}
            </div>
          </div>
        ))}
      </div>
    ),
  },
] as const

export function StoryScroll() {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.62", "end 0.72"],
  })
  const [active, setActive] = useState(0)
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    // 三段进度 → 当前步骤（0/1/2）
    setActive(v <= 0 ? 0 : Math.min(2, Math.floor(v * 3)))
  })

  return (
    <section aria-label="三步了解饭来" ref={ref} className="relative mt-16 sm:mt-20">
      {/* 分节刊头 */}
      <div className="rule-double flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-1.5 pt-1.5">
        <span className="kicker text-[10px] text-foreground/75">How It Works · 三步开饭</span>
        <span className="kicker text-[10px] text-muted-foreground">SCROLL TO LEARN ↓ 往下滑，30 秒看懂饭来</span>
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-12">
        {/* 左栏 sticky：大标题 + 步骤指示（移动端简化为标题） */}
        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-24">
            <h2 className="masthead font-display text-[34px] font-black sm:text-[44px]">
              这碗饭
              <br />
              <span className="ink-highlight">怎么吃</span>？
            </h2>
            <p className="mt-4 max-w-sm text-[14.5px] leading-[1.9] text-muted-foreground">
              饭来不只是名录，而是一整套「从看见企业到端稳 Offer」的节奏器。往下慢慢滑，三步看清它怎么陪你找工作。
            </p>

            {/* 步骤指示器：滚动驱动高亮（桌面端） */}
            <ol className="mt-7 hidden space-y-3 lg:block" aria-hidden>
              {STEPS.map((s, i) => (
                <li key={s.no} className="flex items-center gap-3">
                  <span
                    className={cn(
                      "font-display text-[20px] font-bold leading-none tabular-nums transition-all duration-300",
                      active === i ? "" : "text-foreground/22"
                    )}
                    style={active === i ? { color: s.color } : undefined}
                  >
                    {s.no}
                  </span>
                  <span
                    className={cn(
                      "h-[2px] flex-1 rounded-full transition-all duration-500",
                      active === i ? "opacity-100" : "bg-foreground/10 opacity-60"
                    )}
                    style={active === i ? { background: s.color } : undefined}
                  />
                  <span
                    className={cn(
                      "text-[13px] transition-colors duration-300",
                      active === i ? "font-semibold text-foreground" : "text-muted-foreground/80"
                    )}
                  >
                    {s.title}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* 右栏：三张步骤卡 + 品牌宣言块 */}
        <div className="lg:col-span-7">
          {STEPS.map((s, i) => (
            <motion.article
              key={s.no}
              initial={reduce ? false : { opacity: 0, y: 36 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-18% 0px" }}
              transition={{ duration: 0.55, ease: [0.22, 0.8, 0.3, 1] }}
              className="mb-6 rounded-xl border border-border bg-card p-6 shadow-hard-sm sm:p-8"
              style={{ borderTop: `4px solid ${s.color}` }}
            >
              <div className="flex items-start justify-between gap-4">
                <span
                  aria-hidden
                  className="font-display text-[56px] font-black italic leading-none tabular-nums sm:text-[68px]"
                  style={{ color: s.color }}
                >
                  {s.no}
                </span>
                <span className="kicker mt-2 hidden text-[10px] text-muted-foreground/70 sm:inline">{s.en}</span>
              </div>
              <h3 className="font-display mt-3 text-[24px] font-bold leading-tight sm:text-[28px]">{s.title}</h3>
              <p className="mt-3 text-[14.5px] leading-[1.95] text-muted-foreground">{s.desc}</p>
              <ul className="mt-4 space-y-1.5">
                {s.points.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-[13px] leading-relaxed text-foreground/80">
                    <span
                      aria-hidden
                      className="mt-[7px] size-[6px] shrink-0 rounded-[2px]"
                      style={{ background: s.color }}
                    />
                    {p}
                  </li>
                ))}
              </ul>
              <div
                className="mt-5 flex min-h-[72px] items-center justify-center overflow-x-auto rounded-lg p-3"
                style={{ background: s.soft }}
              >
                {s.art}
              </div>
            </motion.article>
          ))}

          {/* 品牌宣言：墨蓝大色块（奢侈品牌官网式的全幅色带收尾） */}
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-15% 0px" }}
            transition={{ duration: 0.6, ease: [0.22, 0.8, 0.3, 1] }}
            className="block-navy relative overflow-hidden rounded-xl p-8 sm:p-10"
          >
            {/* 海上日出：墨蓝色块里透进一点真实的晨光（真实风景×色块混合） */}
            <Image
              src="/images/scenery-sea-sunrise.png"
              alt=""
              fill
              sizes="(max-width: 1024px) 100vw, 640px"
              className="pointer-events-none absolute inset-0 object-cover opacity-[0.22] mix-blend-screen"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-[#0e2a52] via-[#0e2a52]/60 to-transparent" />
            <span
              aria-hidden
              className="pointer-events-none absolute -bottom-8 -right-4 select-none font-display text-[150px] font-black leading-none text-white/[0.06]"
            >
              来
            </span>
            <FanLaiLogo size={44} className="rounded-[10px]" />
            <p className="font-display mt-5 text-[24px] font-bold leading-snug sm:text-[30px]">
              找到工作，
              <br />
              就是找到一碗饭。
            </p>
            <p className="mt-3 max-w-md text-[13.5px] leading-[1.9] text-white/70">
              饭来相信：机会不该靠小道消息捡漏。把全量名录摊开在你面前，剩下的，是把你心仪的那碗饭端稳。
            </p>
            <p className="kicker mt-6 text-[10.5px] text-white/45">FANLAI · WORK INTO MY BOWL</p>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
