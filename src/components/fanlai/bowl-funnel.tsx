"use client"

import { useMemo } from "react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import type { ApplicationRecord } from "@/lib/types"
import { Button } from "@/components/ui/button"

/**
 * 碗形进度漏斗（Task 27-d · 产品核心差异化视觉）
 *
 * 「工作到我碗里来」的数据化身：碗里的饭随着投递推进从碗底升起，
 * 高度 = Σ(各阶段记录数 × 阶段权重) ÷ 总记录数，权重按流程深度递增
 * （意向 0.15 → Offer 1.0），一碗看得见的进度。
 *
 * 视觉与 LOGO 呼应：开口朝上的深弧碗身 + 柿绯口沿 + 碗足；饭体分层沉淀——
 * 意向 powder / 已投 sky / 笔试 teal / 面试 primary / Offer crimson（绯红浮在饭面上）。
 * 饭面升降走 framer-motion spring（约 1s），数值变化时平滑追上，不跳变。
 */

/** 阶段权重与分层色（bottom → top 沉淀序；色系与五声部一致） */
const STAGES: { status: string; weight: number; color: string }[] = [
  { status: "意向中", weight: 0.15, color: "var(--powder)" },
  { status: "已投递", weight: 0.35, color: "var(--sky)" },
  { status: "笔试中", weight: 0.55, color: "var(--teal)" },
  { status: "面试中", weight: 0.8, color: "var(--primary)" },
  { status: "Offer", weight: 1.0, color: "var(--crimson)" },
]

// 碗体几何（viewBox 220×182）：口沿 y=50，内壁顶 y=54，内壁底 y=150，外壁底 y=156
const RICE_TOP = 54
const RICE_BOTTOM = 150
const RICE_H = RICE_BOTTOM - RICE_TOP
const INTERIOR = "M30 54 H190 C190 112 156 150 110 150 C64 150 30 112 30 54 Z"

/** 饭体谷粒短线：米白的颗粒感（随饭体整体升降） */
const GRAINS: [number, number, number, number][] = [
  [50, 66, 56, 63],
  [80, 60, 86, 57],
  [114, 64, 120, 61],
  [148, 60, 154, 58],
  [168, 70, 174, 67],
  [62, 82, 68, 79],
  [100, 78, 106, 75],
  [136, 84, 142, 81],
  [86, 96, 92, 93],
  [156, 98, 162, 95],
  [72, 110, 78, 107],
  [122, 114, 128, 111],
]

export function BowlFunnel({
  applications,
  loading,
  onGoDirectory,
}: {
  /** 投递记录（当季全量，不受列表筛选影响——碗反映的是整季进度） */
  applications: ApplicationRecord[] | null
  loading: boolean
  onGoDirectory: () => void
}) {
  const { total, byStatus, companies, layers, progress, offered } = useMemo(() => {
    const list = applications ?? []
    const statusCount: Record<string, number> = {}
    for (const a of list) statusCount[a.status] = (statusCount[a.status] ?? 0) + 1
    const withCount = STAGES.map((s) => ({ ...s, count: statusCount[s.status] ?? 0 }))
    const weighted = withCount.reduce((sum, l) => sum + l.count * l.weight, 0)
    return {
      total: list.length,
      byStatus: statusCount,
      companies: new Set(list.map((a) => a.companyId)).size,
      // 层高按「加权量占比」分配：越深的流程沉的饭越厚
      layers: withCount.map((l) => ({ ...l, share: weighted > 0 ? (l.count * l.weight) / weighted : 0 })),
      progress: list.length > 0 ? weighted / list.length : 0,
      offered: statusCount["Offer"] ?? 0,
    }
  }, [applications])

  const pct = Math.round(progress * 100)
  // 饭来了！：有 Offer 或进度 ≥80% 时，碗上方浮出一句绯红小字（每次满足条件弹跳出现一次）
  const flourish = total > 0 && (offered > 0 || progress >= 0.8)
  // 饭体下沉量：进度越低，饭面离碗口越远；spring 平滑升降（约 1s，别太快）
  const riceDy = (1 - progress) * RICE_H
  const pausedCount = byStatus["暂告段落"] ?? 0

  return (
    <section aria-label="碗里进度" className="mt-6 rounded-lg border border-border bg-card">
      {loading && applications === null ? (
        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,280px)_1fr] lg:gap-10">
          <div className="h-64 animate-pulse rounded-lg bg-secondary/60" />
          <div className="space-y-3">
            <div className="h-4 w-32 animate-pulse rounded bg-secondary/60" />
            <div className="h-9 w-full animate-pulse rounded bg-secondary/50" />
            <div className="h-9 w-4/5 animate-pulse rounded bg-secondary/50" />
            <div className="h-9 w-3/5 animate-pulse rounded bg-secondary/40" />
          </div>
        </div>
      ) : (
        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,280px)_1fr] lg:gap-10">
          {/* 左：碗 + 进度大数 */}
          <div className="relative mx-auto flex w-full max-w-[280px] flex-col items-center">
            {flourish && (
              <div aria-hidden className="absolute inset-x-0 top-0 z-10 flex justify-center">
                <motion.p
                  initial={{ opacity: 0, y: 12, scale: 0.7 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: "spring", stiffness: 240, damping: 11 }}
                  className="font-masthead text-[15px] font-black tracking-wide text-[color:var(--crimson)]"
                >
                  饭来了！
                </motion.p>
              </div>
            )}
            <svg
              viewBox="0 0 220 182"
              role="img"
              aria-label={
                total === 0
                  ? "空碗：还没有投递记录"
                  : `碗里进度 ${pct}%：${STAGES.map((s) => `${s.status} ${byStatus[s.status] ?? 0} 条`).join("，")}${
                      pausedCount > 0 ? `，暂告段落 ${pausedCount} 条` : ""
                    }`
              }
              className="mt-6 w-full max-w-[240px] overflow-visible"
            >
              <defs>
                <clipPath id="bowl-funnel-clip">
                  <path d={INTERIOR} />
                </clipPath>
              </defs>

              {/* 碗内壁底色：空碗也能看出碗的纵深 */}
              <path d={INTERIOR} fill="var(--secondary)" opacity={0.45} />

              {/* 饭体：整块随进度升降，层带按加权量占比分配；碗弧裁掉溢出 */}
              <g clipPath="url(#bowl-funnel-clip)">
                <motion.g
                  animate={{ y: riceDy }}
                  transition={{ type: "spring", stiffness: 42, damping: 16, mass: 1.1 }}
                >
                  {total > 0 &&
                    layers
                      .filter((l) => l.share > 0)
                      .map((l, i, arr) => {
                        // 自下而上堆叠：arr 顺序为 意向→Offer，底层的先铺
                        const below = arr.slice(0, i).reduce((s, x) => s + x.share * RICE_H, 0)
                        const h = l.share * RICE_H
                        return (
                          <rect
                            key={l.status}
                            x={28}
                            y={RICE_BOTTOM - below - h}
                            width={164}
                            height={h + 1}
                            fill={l.color}
                          />
                        )
                      })}
                  {/* 谷粒短线：米白颗粒感，让「饭」成立 */}
                  <g stroke="#fdfaf3" strokeWidth={1.6} strokeLinecap="round" opacity={0.5}>
                    {GRAINS.map(([x1, y1, x2, y2], i) => (
                      <path key={i} d={`M${x1} ${y1} L${x2} ${y2}`} />
                    ))}
                  </g>
                </motion.g>
              </g>

              {/* 碗身：深弧外壁（与 LOGO 同款开口朝上的碗），柿绯口沿 */}
              <path
                d="M24 50 H196 C196 114 160 156 110 156 C60 156 24 114 24 50 Z"
                fill="none"
                stroke="var(--primary)"
                strokeWidth={7}
                strokeLinejoin="round"
              />
              <path d="M24 50 H196" stroke="var(--chart-3)" strokeWidth={7} strokeLinecap="round" />
              {/* 碗足 */}
              <path d="M94 158 L126 158 L133 170 L87 170 Z" fill="var(--primary)" stroke="var(--primary)" strokeWidth={3} strokeLinejoin="round" />
              {/* 落影 */}
              <ellipse cx={110} cy={176} rx={52} ry={3} fill="var(--primary)" opacity={0.12} />

              {/* 饭来了的蒸汽：复用 LOGO 的 bowl-steam 动画（reduced-motion 自动静止） */}
              {flourish && (
                <g className="bowl-steam" fill="none" stroke="var(--chart-3)" strokeWidth={2.6} strokeLinecap="round">
                  <path d="M80 38c-2-3 1.5-5 .3-8" />
                  <path d="M110 33c2-3.4-1.3-5.4.1-8.6" />
                  <path d="M140 38c-1.8-3 1.6-5 .4-8" />
                </g>
              )}
            </svg>

            <div className="mt-3 flex items-baseline gap-2.5">
              <span className="figure-serif text-[42px] leading-none">
                {pct}
                <span className="text-[22px]">%</span>
              </span>
              <span className="t-kicker text-muted-foreground">碗里进度</span>
            </div>
          </div>

          {/* 右：明细 */}
          {total === 0 ? (
            <div className="flex min-w-0 flex-col items-start justify-center gap-3 lg:pl-2">
              <p className="t-kicker text-muted-foreground">BOWL PROGRESS · 碗里进度</p>
              <p className="font-display text-[16px] font-bold leading-relaxed text-foreground/85">
                碗还空着<span aria-hidden>——</span>去名录里挑一家，记下第一笔投递
              </p>
              <p className="max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">
                每记一笔，碗里的饭就升高一截；意向、投递、笔试、面试、Offer，层层沉淀都算数。
              </p>
              <Button variant="outline" className="mt-1 h-10 rounded-md text-[13px]" onClick={onGoDirectory}>
                去企业名录逛逛
              </Button>
            </div>
          ) : (
            <div className="flex min-w-0 flex-col">
              <div className="flex items-center gap-3">
                <h2 className="t-kicker shrink-0 text-muted-foreground">碗里进度</h2>
                <span aria-hidden className="h-px flex-1 bg-border/60" />
                <span className="kicker shrink-0 text-[10px] text-muted-foreground/80">BOWL PROGRESS</span>
              </div>
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
                碗里每一粒，都是你投出的底气。{companies} 家企业 · {total} 条记录
                {pausedCount > 0 ? ` · 暂告段落 ${pausedCount} 条不计入进度` : ""}
              </p>

              <div className="mt-3.5 space-y-2">
                {layers.map((l) => {
                  const count = l.count
                  const shareOfTotal = total > 0 ? Math.round((count / total) * 100) : 0
                  return (
                    <div key={l.status} className="flex items-center gap-3">
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-[2.5px]"
                        style={{ background: l.color, opacity: count > 0 ? 1 : 0.3 }}
                      />
                      <span className={cn("w-[52px] shrink-0 text-[12.5px]", count > 0 ? "text-foreground/85" : "text-muted-foreground/80")}>
                        {l.status}
                      </span>
                      <span className="min-w-0 flex-1 overflow-hidden rounded-[3px] bg-secondary/50">
                        <motion.span
                          className="block h-[9px] rounded-[3px]"
                          style={{ background: l.color }}
                          initial={false}
                          animate={{ width: `${Math.max(count > 0 ? 4 : 0, l.share * 100)}%` }}
                          transition={{ type: "spring", stiffness: 42, damping: 16 }}
                        />
                      </span>
                      <span className="w-[74px] shrink-0 text-right t-data text-[12.5px] text-muted-foreground">
                        {count} 条 <span className="text-[12px] text-muted-foreground/70">· {shareOfTotal}%</span>
                      </span>
                    </div>
                  )
                })}
                {pausedCount > 0 && (
                  <div className="flex items-center gap-3 border-t border-border/60 pt-2">
                    <span aria-hidden className="size-2 shrink-0 rounded-[2.5px] bg-stone-300 dark:bg-stone-600" />
                    <span className="w-[52px] shrink-0 text-[12.5px] text-muted-foreground">暂告段落</span>
                    <span className="min-w-0 flex-1" />
                    <span className="w-[74px] shrink-0 text-right t-data text-[12.5px] text-muted-foreground/70">
                      {pausedCount} 条 <span className="text-[12px]">· {Math.round((pausedCount / total) * 100)}%</span>
                    </span>
                  </div>
                )}
              </div>

              <p className="mt-3.5 border-t border-border/60 pt-2.5 text-[12px] leading-relaxed text-muted-foreground/75">
                进度按阶段加权：意向中 ×0.15 · 已投递 ×0.35 · 笔试中 ×0.55 · 面试中 ×0.8 · Offer ×1.0，求和后除以记录总数——
                流程越深，碗里的饭越满。
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
