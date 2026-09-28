"use client"

import { motion } from "framer-motion"
import { VOICE_TAG_STYLE, voiceColumns, type Voice } from "@/lib/voices"

/**
 * 求职心声墙（Task 25-g）
 * 三列纵向慢滚的匿名引用：吐槽 / 鼓励 / 清醒 三种声部，
 * 悬停暂停；底色衬一张极淡的水波抽象图。内容为社交平台常见声音的
 * 匿名化摘编（已抹去来源与用户名），页脚处明确标注。
 */

function VoiceCard({ v }: { v: Voice }) {
  const style = VOICE_TAG_STYLE[v.tag]
  return (
    <figure className="rounded-md border border-border/80 bg-card/90 px-4 py-3.5 backdrop-blur-[2px] transition-colors hover:border-foreground/25">
      <figcaption className="flex items-center gap-2">
        <span aria-hidden className="size-1.5 rounded-full" style={{ background: style.dot }} />
        <span className={`text-[10.5px] font-bold tracking-[0.22em] ${style.chip}`}>{v.tag}</span>
      </figcaption>
      <blockquote className="font-display mt-1.5 text-[13.5px] leading-relaxed text-foreground/90">
        「{v.text}」
      </blockquote>
      <p className="mt-1.5 text-[10.5px] text-muted-foreground/70">—— {v.persona}</p>
    </figure>
  )
}

/** 一列：内容双份 + translateY(-50%) 无缝纵滚 */
function VoiceColumn({ list, speed, reverse }: { list: Voice[]; speed: number; reverse?: boolean }) {
  return (
    <div className="voice-col voice-fade relative h-[320px] overflow-hidden sm:h-[360px]">
      <div
        className="voice-track flex flex-col gap-3"
        style={
          {
            "--spd": `${speed}s`,
            animationDirection: reverse ? "reverse" : "normal",
          } as React.CSSProperties
        }
      >
        {[0, 1].map((dup) => (
          <div key={dup} className="flex flex-col gap-3" aria-hidden={dup === 1}>
            {list.map((v, i) => (
              <VoiceCard key={`${dup}-${i}`} v={v} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function VoiceWall({ className }: { className?: string }) {
  const [c1, c2, c3] = voiceColumns()

  return (
    <motion.section
      aria-label="求职心声：来自社交平台的匿名引用"
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className={`relative overflow-hidden rounded-lg border border-border bg-[#eef4f2] dark:bg-[#0d2a33] ${className ?? ""}`}
    >
      {/* 底图：蓝绿水波抽象，压到极淡（装饰图，aria-hidden + alt=""） */}
      <div className="absolute inset-0" aria-hidden>
        <img
          src="/images/abstract-waves.png"
          alt=""
          loading="lazy"
          className="art-img h-full w-full object-cover opacity-[0.14] dark:opacity-[0.1]"
        />
      </div>

      <div className="relative px-4 pb-5 pt-5 sm:px-6">
        <div className="flex items-center gap-3">
          <h2 className="kicker text-[10px] text-[color:var(--teal-deep)] dark:text-[color:var(--teal)]">
            同路人 · 求职心声
          </h2>
          <span aria-hidden className="h-px flex-1 bg-border/70" />
          <span className="text-[10.5px] text-muted-foreground/70">悬停可暂停</span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <VoiceColumn list={c1} speed={34} />
          <VoiceColumn list={c2} speed={40} reverse />
          {/* 第三列窄屏收进前两列，避免拥挤 */}
          <div className="col-span-2 grid grid-cols-2 gap-3 lg:col-span-1 lg:grid-cols-1">
            <div className="lg:hidden">
              <VoiceColumn list={c3.slice(0, 2)} speed={36} />
            </div>
            <div className="max-lg:hidden">
              <VoiceColumn list={c3} speed={44} />
            </div>
          </div>
        </div>

        <p className="mt-4 text-[10.5px] leading-relaxed text-muted-foreground/80">
          内容整理自社交平台公开讨论中的常见声音，已做匿名化摘编并抹去来源与用户名，仅愿你知道：这条路上的情绪，人皆有之。
        </p>
      </div>
    </motion.section>
  )
}
