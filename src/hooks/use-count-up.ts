"use client"

import { useEffect, useRef, useState } from "react"

/**
 * 数字滚动：目标值变化时从当前展示值平滑追赶（ease-out cubic）。
 * 尊重 prefers-reduced-motion：直接取目标值不做动画。
 * 注意：setState 一律放进 rAF 回调里，避免 effect 体内同步 setState 触发级联渲染。
 */
export function useCountUp(target: number, duration = 650): number {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const from = fromRef.current
    if (from === target) return
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    if (reduce || duration <= 0) {
      const id = requestAnimationFrame(() => {
        fromRef.current = target
        setValue(target)
      })
      return () => cancelAnimationFrame(id)
    }
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(from + (target - from) * eased))
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [target, duration])

  return value
}
