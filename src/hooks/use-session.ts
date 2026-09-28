"use client"

import { useCallback, useEffect, useState } from "react"
import type { SessionUser } from "@/lib/session"

/**
 * useSession —— 客户端登录态 hook
 * - mount 时请求 /api/me（401 视为未登录）
 * - refresh()：手动拉取最新用户（登录/保存偏好后调用）
 * - logout()：调 /api/auth/logout 后清空本地用户
 */
export function useSession() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  // 拉取当前登录态；返回最新 user（未登录为 null），方便调用方衔接后续流程
  const refresh = useCallback(async (): Promise<SessionUser | null> => {
    try {
      const res = await fetch("/api/me", { cache: "no-store" })
      if (res.status === 401) {
        setUser(null)
        return null
      }
      const data = await res.json().catch(() => null)
      const nextUser = (data?.user as SessionUser | undefined) ?? null
      setUser(nextUser)
      return nextUser
    } catch {
      setUser(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // mount 时拉一次
  useEffect(() => {
    void refresh()
  }, [refresh])

  // 注销：调登出 API（清 cookie + 删会话），无论成败都清本地态
  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" })
    } catch {
      // 网络失败也照常清本地态
    }
    setUser(null)
  }, [])

  return { user, loading, refresh, logout }
}
