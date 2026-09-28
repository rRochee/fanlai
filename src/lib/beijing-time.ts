"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * 实时校准的北京时间（客户端）。
 *
 * 原理：
 * 1. 挂载后请求 /api/time 拿服务器时间，按「单程 ≈ 往返一半」估算网络延迟，
 *    得到本机时钟偏移 offset = serverNow - clientNow；
 * 2. 之后任意时刻的准确时间 = Date.now() + offset——即使设备时钟不准，
 *    北京时间依然正确；每 5 分钟自动重新校准一次；
 * 3. 北京时间固定 UTC+8（无夏令时），用 getUTC* 系列读取时分秒。
 *
 * 实现注意：offset 放 ref（effect 只挂载一次），避免「effect 依赖 offset
 * 又在内部 setOffset」造成的校准死循环（会打断每秒时钟）。
 */

const UTC8_MS = 8 * 3600 * 1000

/** 任意时刻 → 北京时间 时/分/秒（含秒的浮点进度，供海浪做连续插值） */
export function beijingParts(ms: number): { h: number; m: number; s: number; t: number } {
  const d = new Date(ms + UTC8_MS)
  const h = d.getUTCHours()
  const m = d.getUTCMinutes()
  const s = d.getUTCSeconds() + d.getUTCMilliseconds() / 1000
  return { h, m, s, t: h + m / 60 + s / 3600 }
}

/** 北京时间 HH:MM:SS 字串（等宽数字排版由调用方处理） */
export function beijingClockLabel(ms: number): string {
  const { h, m, s } = beijingParts(ms)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(h)}:${p(m)}:${p(Math.floor(s))}`
}

/**
 * useBeijingClock：返回 { now, clock, offsetReady }
 * - now 是一个毫秒时间戳 getter（每次调用现算，rAF 内使用零负担）
 * - clock 是每秒更新的显示字串（HH:MM:SS），供 UI 直读
 * - offsetReady 表示已完成至少一次服务器校准
 */
export function useBeijingClock() {
  const [offsetReady, setOffsetReady] = useState(false)
  const [clock, setClock] = useState("")
  const offsetRef = useRef(0)

  useEffect(() => {
    let alive = true

    const calibrate = async () => {
      try {
        const t0 = Date.now()
        const res = await fetch("/api/time", { cache: "no-store" })
        if (!res.ok) return
        const data = (await res.json()) as { now: number }
        if (!alive || typeof data?.now !== "number") return
        const rtt = Date.now() - t0
        offsetRef.current = data.now + rtt / 2 - Date.now()
        setOffsetReady(true)
      } catch {
        /* 校准失败就沿用本机时钟，不打扰 */
      }
    }

    calibrate()
    const timer = window.setInterval(calibrate, 5 * 60 * 1000)
    const tick = window.setInterval(() => {
      setClock(beijingClockLabel(Date.now() + offsetRef.current))
    }, 1000)

    return () => {
      alive = false
      window.clearInterval(timer)
      window.clearInterval(tick)
    }
  }, [])

  // now 必须是稳定引用（useCallback）：否则每次渲染都是新函数，
  // 依赖它的 effect（海浪光效等）会「渲染 → effect → setState → 渲染」死循环
  const now = useCallback(() => Date.now() + offsetRef.current, [])
  return { now, clock, offsetReady }
}
