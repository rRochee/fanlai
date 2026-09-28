"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Sun } from "lucide-react"
import { cn } from "@/lib/utils"
import { beijingParts, useBeijingClock } from "@/lib/beijing-time"
import { solarAt } from "@/lib/solar"

/**
 * 全站海浪背景 · v3 —— 实拍视频素材 + 太阳直射点光效。
 *
 * 底层是 fixed 全屏的四段实拍海浪视频（public/videos/，Pexels 素材 ·
 * 免费商用授权），按太阳直射点自动切换、交叉淡入——不再用 CSS 画浪：
 *   上午/中午/下午 → ocean-day     （平静海面 · 航拍）
 *   日出/清晨后段   → ocean-sunrise（日出海平线）
 *   黄昏/日落       → ocean-sunset （晚霞映海）
 *   月生/星空       → ocean-night  （月光海面）
 * 其上再叠光效层，每秒按「服务器校准的北京时间 + Spencer 太阳公式」
 * 连续插值九档光色：清晨 → 日出 → 上午 → 中午 → 下午 → 黄昏 → 日落 →
 * 月生 → 星空——浪是真的，光是真的时间。
 *
 * 光效三档 soft/normal/blaze（左下角小钮，localStorage 记忆）调染色强度。
 * prefers-reduced-motion 时视频暂停、星空静止，配色照常。
 */

type LightMode = "soft" | "normal" | "blaze"
type VideoGroup = "day" | "sunrise" | "sunset" | "night"

const VIDEOS: Record<VideoGroup, string> = {
  day: "/videos/ocean-day.mp4",
  sunrise: "/videos/ocean-sunrise.mp4",
  sunset: "/videos/ocean-sunset.mp4",
  night: "/videos/ocean-night.mp4",
}
const VIDEO_ORDER: VideoGroup[] = ["day", "sunrise", "sunset", "night"]

/** 太阳高度角 + 上午/下午 → 视频素材分组（与九档光色相位对齐） */
function groupOf(elev: number, morning: boolean): VideoGroup {
  if (morning) {
    if (elev < -1) return "night"
    if (elev < 8) return "sunrise"
    return "day"
  }
  if (elev >= 18) return "day"
  if (elev >= -1) return "sunset"
  return "night"
}

const LIGHT_LABEL: Record<LightMode, string> = {
  soft: "柔和",
  normal: "适中",
  blaze: "炽烈",
}
const LIGHT_K: Record<LightMode, number> = { soft: 0.55, normal: 1, blaze: 1.7 }
const LIGHT_ORDER: LightMode[] = ["soft", "normal", "blaze"]

type RGB = [number, number, number]
type Palette = {
  sky1: RGB // 天顶
  sky2: RGB // 天际（海平线上方）
  sea1: RGB // 近海平线海色
  sea2: RGB // 近景深海色
  sun: RGB // 光斑颜色
  sunA: number // 光斑透明度
}

/** 九档光色调色板（浅色模式；暗色模式在组件里再压夜幕） */
const P: Record<string, Palette> = {
  星空: { sky1: [13, 31, 58], sky2: [26, 58, 92], sea1: [13, 36, 64], sea2: [4, 13, 27], sun: [182, 206, 236], sunA: 0.34 },
  清晨: { sky1: [58, 74, 114], sky2: [232, 164, 140], sea1: [85, 113, 156], sea2: [20, 40, 74], sun: [255, 170, 150], sunA: 0.5 },
  日出: { sky1: [143, 167, 207], sky2: [255, 217, 162], sea1: [192, 138, 110], sea2: [39, 71, 110], sun: [255, 192, 120], sunA: 0.9 },
  上午: { sky1: [169, 205, 240], sky2: [238, 247, 255], sea1: [111, 166, 210], sea2: [30, 67, 112], sun: [255, 246, 220], sunA: 0.62 },
  中午: { sky1: [142, 194, 238], sky2: [240, 248, 255], sea1: [95, 157, 203], sea2: [23, 58, 96], sun: [255, 252, 240], sunA: 0.75 },
  下午: { sky1: [165, 197, 230], sky2: [246, 239, 220], sea1: [109, 163, 196], sea2: [32, 72, 108], sun: [255, 240, 200], sunA: 0.68 },
  黄昏: { sky1: [143, 147, 180], sky2: [248, 201, 142], sea1: [176, 138, 118], sea2: [44, 63, 98], sun: [255, 162, 92], sunA: 0.88 },
  日落: { sky1: [106, 93, 132], sky2: [255, 157, 110], sea1: [150, 120, 126], sea2: [38, 52, 90], sun: [255, 124, 74], sunA: 0.92 },
  月生: { sky1: [49, 61, 102], sky2: [196, 122, 134], sea1: [60, 76, 122], sea2: [20, 33, 62], sun: [205, 218, 242], sunA: 0.42 },
}

/** 光色插值锚点：上午侧与下午侧在「中午」「星空」两端自然接轨 */
const MORNING_ANCHORS: Array<[number, Palette]> = [
  [30, P.中午],
  [12, P.上午],
  [2, P.日出],
  [-6, P.清晨],
  [-14, P.星空],
]
const EVENING_ANCHORS: Array<[number, Palette]> = [
  [30, P.中午],
  [18, P.下午],
  [10, P.黄昏],
  [2, P.日落],
  [-5, P.月生],
  [-13, P.星空],
]

const mixRGB = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
]
const cssRGB = (c: RGB): string => `rgb(${c[0]},${c[1]},${c[2]})`

function mixPalette(a: Palette, b: Palette, t: number): Palette {
  return {
    sky1: mixRGB(a.sky1, b.sky1, t),
    sky2: mixRGB(a.sky2, b.sky2, t),
    sea1: mixRGB(a.sea1, b.sea1, t),
    sea2: mixRGB(a.sea2, b.sea2, t),
    sun: mixRGB(a.sun, b.sun, t),
    sunA: a.sunA + (b.sunA - a.sunA) * t,
  }
}

function paletteAt(elev: number, morning: boolean): Palette {
  const anchors = morning ? MORNING_ANCHORS : EVENING_ANCHORS
  if (elev >= anchors[0][0]) return anchors[0][1]
  for (let i = 0; i < anchors.length - 1; i++) {
    const [eHi, pHi] = anchors[i]
    const [eLo, pLo] = anchors[i + 1]
    if (elev >= eLo) return mixPalette(pHi, pLo, (eHi - elev) / (eHi - eLo))
  }
  return anchors[anchors.length - 1][1]
}

/** 太阳高度角 + 上午/下午 → 九档相位标签（日出日落段取 -1~8° 保金光可感知） */
function phaseOf(elev: number, morning: boolean): string {
  if (elev < -12) return "星空"
  if (morning) {
    if (elev < -1) return "清晨"
    if (elev < 8) return "日出"
    if (elev < 32) return "上午"
    return "中午"
  }
  if (elev < -1) return "月生"
  if (elev < 8) return "日落"
  if (elev < 18) return "黄昏"
  if (elev < 32) return "下午"
  return "中午"
}

export function OceanBackground() {
  const { now, clock, offsetReady } = useBeijingClock()
  const [light, setLight] = useState<LightMode>("normal")
  const [group, setGroup] = useState<VideoGroup>("day")
  const [phase, setPhase] = useState("校准中")
  const [elev, setElev] = useState(0)
  const [ctrlOpen, setCtrlOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const videoRefs = useRef<Partial<Record<VideoGroup, HTMLVideoElement | null>>>({})
  const reduceRef = useRef(false)
  const groupRef = useRef<VideoGroup>("day")

  // 挂载后恢复光效偏好
  useEffect(() => {
    try {
      const l = window.localStorage.getItem("fanlai-light")
      if (l === "soft" || l === "normal" || l === "blaze") setLight(l)
    } catch {}
  }, [])

  // 当前分组起播、其余暂停；reduced-motion 时全部静止
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    reduceRef.current = mq.matches
    const apply = () => {
      for (const g of VIDEO_ORDER) {
        const v = videoRefs.current[g]
        if (!v) continue
        if (!mq.matches && g === group) v.play().catch(() => {})
        else v.pause()
      }
    }
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [group])

  // 每秒：校准后的北京时间 → 太阳直射点 → 光效变量写入。
  // 主体抽成 applyOcean：每秒 tick 与「标签页重新可见」共用同一份逻辑
  //（now 不能进依赖数组——毫秒级浮点必然变化，会造成无限渲染循环）
  const nowRef = useRef(now)
  nowRef.current = now
  const applyOcean = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const ms = nowRef.current()
    const { t } = beijingParts(ms)
    const s = solarAt(t, ms)
    const morning = t < 12
    const pal = paletteAt(s.elevDeg, morning)
    const dark = document.documentElement.classList.contains("dark")
    const nightMix = dark ? 0.55 : 0 // 暗色模式整体压向夜幕

    const set = (k: string, v: string) => el.style.setProperty(k, v)
    const NIGHT: RGB = [10, 22, 38]
    const SEA_NIGHT: RGB = [6, 16, 30]
    set("--o-sky1", cssRGB(mixRGB(pal.sky1, NIGHT, nightMix)))
    set("--o-sky2", cssRGB(mixRGB(pal.sky2, NIGHT, nightMix * 0.8)))
    set("--o-sea1", cssRGB(mixRGB(pal.sea1, SEA_NIGHT, nightMix)))
    set("--o-sea2", cssRGB(mixRGB(pal.sea2, [3, 10, 22], nightMix * 0.6)))
    set(
      "--o-sun",
      `rgba(${pal.sun[0]},${pal.sun[1]},${pal.sun[2]},${(pal.sunA * (dark ? 0.82 : 1)).toFixed(3)})`
    )
    // 太阳/月亮天幕方位与大小
    set("--sun-x", `${(s.x01 * 100).toFixed(2)}%`)
    set("--sun-y", `${Math.min(44, Math.max(-8, (1 - s.y01) * 46)).toFixed(2)}%`)
    set("--sun-size", s.sunSize.toFixed(3))
    // 时段染色：视频素材已对准时段，只做轻量统一调色（太阳低垂染更浓）
    // 上限压到 0.35——染色太浓会把实拍浪形盖成一片色块，浪要看得清
    const tint = Math.min(0.35, Math.min(0.1 + s.warm * 0.18, 0.3) * LIGHT_K[light])
    set("--tint-o", tint.toFixed(3))
    // 视频分组（按太阳高度角切换日/日出/日落/夜素材）
    const grp = groupOf(s.elevDeg, morning)
    groupRef.current = grp
    setGroup(grp)
    // 夜幕压暗：夜晚素材本身已暗，只轻压；白天素材入夜后重压
    const nightBase = s.nightK * (dark ? 0.8 : 0.62)
    set("--night-o", Math.min(0.85, grp === "night" ? nightBase * 0.35 : nightBase).toFixed(3))
    // 星空：夜晚素材自带月光，叠加星空减半
    const starsBase = s.nightK * (dark ? 1 : 0.85)
    set("--stars-o", (grp === "night" ? starsBase * 0.4 : starsBase).toFixed(3))
    // 白纱强度：夜里减淡（最低 0.62）——夜素材与月光特征要透出来，
    // 别把月光海洗成白昼感；裸文字可读性由残余纱 + 内容卡片兜底
    set("--veil-k", (1 - s.nightK * 0.38).toFixed(3))
    setPhase(phaseOf(s.elevDeg, morning))
    setElev(Math.round(s.elevDeg * 10) / 10)
  }, [light])

  useEffect(() => {
    applyOcean()
  }, [clock, applyOcean])

  // 后台标签冻结兜底：dev 重启 / HMR 断连 / 睡眠唤醒后，每秒 tick 可能
  // 停摆，切回标签时画面会停在断连前的时段（夜里看白天素材的来源）。
  // 重新可见/聚焦时立即重算光效并同步视频播放——直读 groupRef，
  // 不等 React 状态传播
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const syncVideos = () => {
      for (const g of VIDEO_ORDER) {
        const v = videoRefs.current[g]
        if (!v) continue
        if (!mq.matches && g === groupRef.current) v.play().catch(() => {})
        else v.pause()
      }
    }
    const resync = () => {
      applyOcean()
      syncVideos()
    }
    document.addEventListener("visibilitychange", resync)
    window.addEventListener("focus", resync)
    window.addEventListener("pageshow", resync)
    return () => {
      document.removeEventListener("visibilitychange", resync)
      window.removeEventListener("focus", resync)
      window.removeEventListener("pageshow", resync)
    }
  }, [applyOcean])

  // 滚动视差：进度 → --sea-shift（rAF 节流），视频轻微上移
  useEffect(() => {
    let raf = 0
    let queued = false
    const update = () => {
      queued = false
      const el = wrapRef.current
      if (!el) return
      const max = document.documentElement.scrollHeight - window.innerHeight
      const p = max > 0 ? Math.min(1, window.scrollY / max) : 0
      el.style.setProperty("--sea-shift", p.toFixed(3))
    }
    const onScroll = () => {
      if (queued) return
      queued = true
      raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

  const chooseLight = (m: LightMode) => {
    setLight(m)
    try {
      window.localStorage.setItem("fanlai-light", m)
    } catch {}
  }

  return (
    <>
      {/* 视觉层：fixed 全屏，绘制在 body 纸面之上、内容之下 */}
      <div ref={wrapRef} aria-hidden className="ocean-wrap">
        {/* 四段实拍海浪视频（Pexels · 免费商用授权），按太阳直射点交叉淡入 */}
        {VIDEO_ORDER.map((g) => (
          <video
            key={g}
            ref={(el) => {
              videoRefs.current[g] = el
            }}
            className={cn("ocean-video", g === group && "ocean-video-active")}
            src={VIDEOS[g]}
            muted
            loop
            playsInline
            autoPlay={g === "day"}
            preload="auto"
          />
        ))}
        {/* 时段染色：九档光色随真实时间罩在视频上 */}
        <div className="ocean-tint" />
        {/* 可读性薄纱：页头/页脚文字区垫柔光，中段保持海浪清晰 */}
        <div className="ocean-veil" />
        {/* 夜幕压暗 */}
        <div className="ocean-night" />
        {/* 星空（夜间渐现） */}
        <div className="ocean-stars" />
        {/* 太阳/月亮光斑 */}
        <div className="ocean-sun" />
      </div>

      {/* 海况控件：左下角一颗小钮，点开「北京时间 · 相位 · 光效」 */}
      <div className="fixed bottom-4 left-4 z-30 hidden flex-col items-start gap-2 sm:flex">
        {ctrlOpen && (
          <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card/95 p-3.5 shadow-[0_4px_16px_rgba(12,35,64,0.12)] backdrop-blur">
            <p className="text-[11px] tabular-nums tracking-wide text-muted-foreground" aria-live="off">
              <span className="font-medium text-foreground">{clock}</span>
              <span className="mx-1.5 text-current/40">·</span>
              <span className="font-medium text-foreground">{phase}</span>
              <span className="mx-1.5 text-current/40">·</span>
              太阳 {elev >= 0 ? "+" : ""}
              {elev.toFixed(1)}°
              {!offsetReady && <span className="ml-1.5 text-current/50">（本机时钟）</span>}
            </p>
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-[10.5px] tracking-[0.2em] text-muted-foreground">光效</span>
              <div
                role="radiogroup"
                aria-label="海面光效"
                className="flex items-center gap-0.5 rounded-full border border-border bg-background/80 p-0.5"
              >
                {LIGHT_ORDER.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={light === m}
                    onClick={() => chooseLight(m)}
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[11.5px] font-medium transition-colors",
                      light === m
                        ? "bg-[color:var(--sky)] text-white"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {LIGHT_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => setCtrlOpen((v) => !v)}
          aria-expanded={ctrlOpen}
          aria-label="调整海面光效"
          title="海面光效"
          className={cn(
            "flex size-9 items-center justify-center rounded-full border border-border bg-card/90 text-muted-foreground shadow-[0_2px_10px_rgba(12,35,64,0.1)] backdrop-blur transition-all hover:border-foreground/30 hover:text-foreground",
            ctrlOpen && "border-[color:var(--sky)]/60 text-[color:var(--sky)]"
          )}
        >
          <Sun className="size-4.5" strokeWidth={1.7} />
        </button>
      </div>
    </>
  )
}
