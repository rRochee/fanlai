"use client"

import { useReducedMotion } from "framer-motion"
import { cn } from "@/lib/utils"

/**
 * 饭来品牌 Logo · 3.2 —— 时尚杂志式极简几何。
 * 全部品牌意象收敛成两个元素：
 *   一条向下弯的碗弧（碗，也是一轮初月——盛得下东西的容器），
 *   一颗绯红圆点（那份工作 / Offer）悬在弧口上方。
 * 「点落进弧里」=「工作到我碗里来」。没有第三条线，留白即设计。
 *
 * animated 模式（3.3 升级 · 垂直弹动下落）：
 * 绯红点先在碗口正上方悬停，随即沿**垂直直线**加速下坠落向碗心
 * （不走弧线），触碗后「弹一下、再弹一下」收稳（两段回弹，节奏明快），
 * 在碗中化开隐去，再回到碗口正上方——整个周期 4.8s。
 * 落碗瞬间泛起一圈涟漪（.logo-splash，与落点周期同步）。
 * prefers-reduced-motion 时退化为静止圆点。
 */
export function FanLaiLogo({
  size = 36,
  className,
  animated = false,
}: {
  size?: number
  className?: string
  animated?: boolean
}) {
  const reduce = useReducedMotion()
  const play = animated && !reduce

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      className={cn("shrink-0", className)}
    >
      {/* 碗弧：开口朝上的深弧，一笔圆头线条，墨色 / 月光白自适应 */}
      <path
        d="M12.5 21.5 A 20 20 0 0 0 51.5 21.5"
        fill="none"
        strokeLinecap="round"
        strokeWidth="3.2"
        className="logo-ink"
      />

      {play ? (
        <>
          {/* 落点涟漪：点入碗时的一圈水痕（CSS 同周期 4.8s 动画） */}
          <path
            d="M25.5 34.6 Q32.5 38.4 39.5 34.6"
            fill="none"
            strokeLinecap="round"
            strokeWidth="1.5"
            className="logo-splash"
          />
          {/* 绯红点：垂直直线加速下落 + 触碗两段回弹（animateMotion 按路径坐标定位，圆心归零）
              路径五段全部竖直：碗口上方 (33,7) 直落碗心 (33,31.5) → 弹起 → 落回 → 小弹 → 收稳，
              各段长度 24.5/8/8/4/4，keyPoints 取累计长度比例（≈0.505/0.67/0.835/0.917/1），
              keyTimes：悬停 10% → 直落 22% → 弹跳 → 停留化开 → 瞬回碗口渐显 */}
          <g className="logo-accent-fill">
            <circle r="4.8" />
            <animateMotion
              dur="4.8s"
              repeatCount="indefinite"
              path="M33,7 L33,31.5 L33,23.5 L33,31.5 L33,27.5 L33,31.5"
              keyPoints="0;0;0.505;0.67;0.835;0.917;1;1;0;0"
              keyTimes="0;0.10;0.32;0.42;0.52;0.58;0.64;0.84;0.85;1"
              calcMode="spline"
              keySplines="0 0 1 1;0.55 0 1 0.45;0 0 0.58 1;0.55 0 1 0.45;0 0 0.58 1;0.5 0 1 0.5;0 0 1 1;0 0 1 1;0 0 1 1"
            />
            <animate
              attributeName="opacity"
              dur="4.8s"
              repeatCount="indefinite"
              values="1;1;1;1;1;1;1;0.45;0;0;1;1"
              keyTimes="0;0.10;0.32;0.42;0.52;0.58;0.64;0.74;0.81;0.855;0.92;1"
            />
          </g>
        </>
      ) : (
        /* 静态：绯红圆点悬于弧口右上 */
        <circle cx="41.5" cy="11.5" r="4.8" className="logo-accent-fill" />
      )}
    </svg>
  )
}
