"use client"

import Image from "next/image"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

/**
 * 视图横幅图卡：五视图共用的「一视图一性格」氛围条。
 * 图（next/image fill）+ 主题化遮罩 + 左下文案（kicker / 大标 / 小字）+ 右上角可选招牌句。
 *
 * tone 四声部（与导航五声部色系同源）：
 * - dark：深墨纱 + 白字——通用风景 / 行业封面插画（企业名录）
 * - light：白纱 + 墨蓝字——清晨场景（我的清单）；暗色模式自动翻成墨蓝纱 + 白字
 * - teal：蓝绿氛围 + 白字——投递看板
 * - navy：墨蓝数据故事头 + 白字——求职洞察（亮暗同底，天然无违和）
 *
 * 动画克制：仅 whileInView 一次轻渐入，reduced-motion 由 framer-motion 自行降级。
 */

export type ViewBannerTone = "dark" | "light" | "teal" | "navy"

const SCRIMS: Record<ViewBannerTone, string> = {
  dark: "bg-gradient-to-t from-[#081a30]/85 via-[#0c2340]/30 to-transparent dark:from-black/80 dark:via-black/35",
  light:
    "bg-gradient-to-r from-white/90 via-white/55 to-white/10 dark:from-[#0c2340]/90 dark:via-[#0c2340]/55 dark:to-[#0c2340]/10",
  teal:
    "bg-gradient-to-r from-[#073f39]/90 via-[#0a4a50]/48 to-[#0c2340]/12 dark:from-[#032b28]/92 dark:via-[#063a40]/55 dark:to-transparent",
  navy:
    "bg-gradient-to-r from-[#0e2a52]/95 via-[#0e2a52]/72 to-[#0e2a52]/30 dark:from-[#081a30]/95 dark:via-[#0a2138]/75 dark:to-[#0a2138]/35",
}

export function ViewBanner({
  src,
  alt,
  title,
  note,
  kicker,
  badge,
  tone = "dark",
  as: Tag = "h2",
  className,
  sizes = "(max-width: 640px) 100vw, (max-width: 1280px) 92vw, 1104px",
  priority = false,
}: {
  src: string
  alt: string
  /** 左下大标（横幅的性格句 / 行业名 / 视图名） */
  title: string
  /** 大标下的小字（数量、状态等补充信息） */
  note?: string
  /** 左上小字刊眉（编辑风 kicker） */
  kicker?: string
  /** 右上角招牌句（如行业欢迎语） */
  badge?: string
  tone?: ViewBannerTone
  /** 标题语义层级：独立成页头时用 h1 */
  as?: "h1" | "h2"
  /** 高度等外部布局控制（如 h-40 sm:h-52） */
  className?: string
  sizes?: string
  priority?: boolean
}) {
  const light = tone === "light"
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className={cn("cover-img relative w-full overflow-hidden rounded-xl border border-border/80", className)}
    >
      <Image src={src} alt={alt} fill sizes={sizes} priority={priority} className="object-cover" />
      <div aria-hidden className={cn("absolute inset-0", SCRIMS[tone])} />
      {badge && (
        <span
          className={cn(
            "absolute right-3 top-3 max-w-[60%] truncate rounded-full border px-2.5 py-1 text-[11px] tracking-wide backdrop-blur-sm sm:right-4 sm:top-4",
            light
              ? "border-[#0c2340]/15 bg-white/75 text-[#0c2340] dark:border-white/25 dark:bg-white/10 dark:text-white"
              : "border-white/30 bg-white/12 text-white"
          )}
        >
          {badge}
        </span>
      )}
      <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
        {kicker && (
          <p className={cn("kicker text-[10.5px]", light ? "text-[#0c2340]/60 dark:text-white/60" : "text-white/65")}>
            {kicker}
          </p>
        )}
        <Tag
          className={cn(
            "font-display mt-1 text-[19px] font-bold leading-snug tracking-wide sm:text-[22px]",
            light ? "text-[#0c2340] dark:text-white" : "text-white drop-shadow-[0_1px_8px_rgba(8,26,48,0.35)]"
          )}
        >
          {title}
        </Tag>
        {note && (
          <p
            className={cn(
              "mt-1 text-[12px] leading-relaxed sm:text-[13px]",
              light ? "text-[#0c2340]/75 dark:text-white/75" : "text-white/85"
            )}
          >
            {note}
          </p>
        )}
      </div>
    </motion.div>
  )
}
