"use client"

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { AnimatePresence, motion, type Variants } from "framer-motion"
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FanLaiLogo } from "./logo"
import type { SessionUser } from "@/lib/session"

/**
 * 登录页（全屏，杂志框架）—— 演示环境三种登录方式：
 * ① 智谱账号（邮箱验证码，ZHIPU AI 徽章）② 邮箱验证码 ③ 微信扫码（模拟扫码成功按钮）。
 * props: onLoggedIn(user) 登录成功回传用户；onGuest() 「先逛逛」免登录进入。
 */

type Mode = "choose" | "email" | "zhipu" | "wechat"

// 宽松邮箱格式（与 API 端一致）
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// useSyncExternalStore 的空订阅（值不随外部系统变化，仅在注水后取客户端快照）
const emptySubscribe = () => () => {}

// 今天的刊号标签：VOL.天数 · M 月 D 日 · 星期 X（纯客户端显示用）
function getTodayLabel() {
  const d = new Date()
  const start = new Date(d.getFullYear(), 0, 0)
  const vol = Math.floor((d.getTime() - start.getTime()) / 86400000)
  return `VOL.${vol} · ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 星期${"日一二三四五六"[d.getDay()]}`
}

// 三种登录方式（choose 模式的卡片清单）
const OPTIONS: { key: Exclude<Mode, "choose">; title: string; desc: string; badge?: string }[] = [
  { key: "zhipu", title: "智谱账号", desc: "GLM 同源账号，验证码即到即用", badge: "ZHIPU AI" },
  { key: "email", title: "邮箱验证码", desc: "任何邮箱都可以，一分钟登录" },
  { key: "wechat", title: "微信扫码", desc: "扫一扫，和饭来打个照面" },
]

// framer-motion 错峰入场
const stack: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.12 } },
}
const rise: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
}

// ---------- 伪二维码：qrId 做种子，确定性生成 12x12 黑白格 ----------

function hashCode(str: string) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 三个角画 3x3 定位标（模拟 QR 视觉），其余格子由 qrId 哈希决定
function qrCells(qrId: string): boolean[][] {
  const rand = mulberry32(hashCode(qrId))
  const n = 12
  const cells: boolean[][] = []
  for (let r = 0; r < n; r++) {
    const row: boolean[] = []
    for (let c = 0; c < n; c++) {
      const isFinder = (r < 3 && c < 3) || (r < 3 && c > n - 4) || (r > n - 4 && c < 3)
      row.push(isFinder ? true : rand() < 0.42)
    }
    cells.push(row)
  }
  return cells
}

function QrSvg({ cells }: { cells: boolean[][] }) {
  const n = cells.length
  return (
    <svg
      viewBox={`-1.2 -1.2 ${n + 2.4} ${n + 2.4}`}
      className="block h-full w-full text-[#16335c]"
      shapeRendering="crispEdges"
      aria-hidden
    >
      {cells.flatMap((row, r) =>
        row.map((on, c) =>
          on ? (
            <rect key={`${r}-${c}`} x={c} y={r} width={1.04} height={1.04} fill="currentColor" />
          ) : null
        )
      )}
    </svg>
  )
}

// ---------- 登录方式面板：展开动效容器 ----------

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden"
    >
      <div className="pt-3">{children}</div>
    </motion.div>
  )
}

// ---------- 邮箱 / 智谱账号：验证码登录表单 ----------

function CodeLoginPanel({
  provider,
  onLoggedIn,
}: {
  provider: "email" | "zhipu"
  onLoggedIn: (u: SessionUser) => void
}) {
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [sending, setSending] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const codeRef = useRef<HTMLInputElement>(null)

  // 60s 重发倒计时
  useEffect(() => {
    if (countdown <= 0) return
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000)
    return () => clearInterval(t)
  }, [countdown])

  const emailValid = EMAIL_RE.test(email.trim())

  // 获取验证码：演示环境后端把 devCode 直接返回，用 toast 展示
  const sendCode = async () => {
    if (sending || countdown > 0 || !emailValid) return
    setSending(true)
    try {
      const res = await fetch("/api/auth/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) {
        setCountdown(60)
        toast.info(`演示验证码：${data.devCode}`, {
          description: "生产环境会发进你的邮箱，演示环境直接给你看",
        })
        codeRef.current?.focus()
      } else {
        toast.error(data?.error ?? "验证码发送失败，稍后再试")
      }
    } catch {
      toast.error("网络不太顺，稍后再试一次")
    } finally {
      setSending(false)
    }
  }

  // 登录：成功即回传用户给外层
  const submit = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, email: email.trim(), code: code.trim() }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) {
        toast.success(`开饭啦，欢迎回来，${data.user.name}`)
        onLoggedIn(data.user as SessionUser)
      } else {
        toast.error(data?.error ?? "登录失败，稍后再试")
      }
    } catch {
      toast.error("网络不太顺，稍后再试一次")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-foreground/10 bg-white/70 p-4 dark:bg-white/[0.04]">
      <Input
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder={provider === "zhipu" ? "智谱账号邮箱" : "邮箱地址"}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="h-11"
      />
      <div className="flex gap-2">
        <Input
          ref={codeRef}
          inputMode="numeric"
          maxLength={6}
          placeholder="6 位验证码"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="h-11 flex-1 tracking-[0.35em]"
        />
        <Button
          type="button"
          variant="outline"
          className="h-11 min-w-[118px] whitespace-nowrap"
          onClick={sendCode}
          disabled={sending || countdown > 0 || !emailValid}
        >
          {sending ? (
            <>
              <Loader2 className="size-4 animate-spin" /> 发送中
            </>
          ) : countdown > 0 ? (
            `${countdown}s 后可重发`
          ) : (
            "获取验证码"
          )}
        </Button>
      </div>
      <Button
        type="button"
        className="h-11 w-full"
        onClick={submit}
        disabled={submitting || !emailValid || code.length !== 6}
      >
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" /> 正在开饭…
          </>
        ) : provider === "zhipu" ? (
          "以智谱账号登录"
        ) : (
          "登录饭来"
        )}
      </Button>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        演示环境不真发邮件，验证码会以提示气泡直接显示；生产环境请查收邮箱。
      </p>
    </div>
  )
}

// ---------- 微信扫码：伪二维码 + 模拟扫码成功 ----------

function WechatPanel({ onLoggedIn }: { onLoggedIn: (u: SessionUser) => void }) {
  const [qrId, setQrId] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [loadingQr, setLoadingQr] = useState(false)
  const [scanning, setScanning] = useState(false)

  // 进入面板即签发一个 5 分钟有效的 qrId
  const issue = async () => {
    setLoadingQr(true)
    try {
      const res = await fetch("/api/auth/wechat-qr", { cache: "no-store" })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.qrId) {
        setQrId(data.qrId)
        setExpiresAt(Date.now() + (data.expiresIn ?? 300) * 1000)
        setNow(Date.now())
      } else {
        toast.error("二维码签发失败，稍后再试")
      }
    } catch {
      toast.error("网络不太顺，稍后再试一次")
    } finally {
      setLoadingQr(false)
    }
  }

  useEffect(() => {
    void issue()
    // 仅在面板挂载时签发一次；过期后由遮罩按钮手动刷新
  }, [])

  // 每秒刷新一次倒计时
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const remain = expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : 0
  const expired = qrId !== null && remain <= 0
  const cells = useMemo(() => qrCells(qrId ?? ""), [qrId])

  // 「模拟扫码成功」：用当前 qrId 走 wechat 登录
  const scan = async () => {
    if (!qrId || expired || scanning) return
    setScanning(true)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "wechat", qrId }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) {
        toast.success(`开饭啦，欢迎回来，${data.user.name}`)
        onLoggedIn(data.user as SessionUser)
      } else {
        toast.error(data?.error ?? "登录失败，稍后再试")
      }
    } catch {
      toast.error("网络不太顺，稍后再试一次")
    } finally {
      setScanning(false)
    }
  }

  const mm = Math.floor(remain / 60)
  const ss = String(remain % 60).padStart(2, "0")

  return (
    <div className="rounded-lg border border-foreground/10 bg-white/70 p-4 dark:bg-white/[0.04]">
      <div className="mx-auto w-[196px] max-w-full">
        <div className="relative aspect-square rounded-md bg-white p-3 ring-1 ring-black/10">
          {qrId && !expired ? (
            <QrSvg cells={cells} />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-white">
              {loadingQr || !qrId ? (
                <Loader2 className="size-5 animate-spin text-[#16335c]/40" />
              ) : null}
            </div>
          )}
          {/* 过期遮罩：点击刷新重新签发 */}
          {expired && (
            <button
              type="button"
              onClick={issue}
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md bg-white/92 text-[#16335c]"
            >
              <span className="text-sm font-medium">二维码已过期</span>
              <span className="text-xs underline underline-offset-4">点击刷新二维码</span>
            </button>
          )}
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          {expired ? "刷新后重新扫码" : `有效期还剩 ${mm}:${ss}`}
        </p>
      </div>
      <Button
        type="button"
        className="mt-3 h-11 w-full"
        onClick={scan}
        disabled={!qrId || expired || scanning}
      >
        {scanning ? (
          <>
            <Loader2 className="size-4 animate-spin" /> 扫码中…
          </>
        ) : (
          "模拟扫码成功（演示）"
        )}
      </Button>
      <p className="mt-2 text-center text-[11px] leading-relaxed text-muted-foreground">
        演示环境无需真实微信，点上面按钮即完成扫码；生产环境为微信 OAuth 托管扫码。
      </p>
    </div>
  )
}

// ---------- 主组件 ----------

export function LoginView({
  onLoggedIn,
  onGuest,
}: {
  onLoggedIn: (user: SessionUser) => void
  onGuest: () => void
}) {
  const [mode, setMode] = useState<Mode>("choose")
  // 刊号行日期：useSyncExternalStore 的标准「客户端专属值」用法——
  // SSR/注水阶段返回空串，注水完成后无警告地切到客户端本机日期（避免时区不一致的 hydration 警告）
  const dateLabel = useSyncExternalStore(emptySubscribe, getTodayLabel, () => "")

  const toggle = (key: Exclude<Mode, "choose">) =>
    setMode((m) => (m === key ? "choose" : key))

  return (
    <div className="paper-light relative min-h-[100svh] overflow-hidden bg-[#f7f4ed] text-foreground dark:bg-[#0a1c33]">
      <div className="mx-auto flex min-h-[100svh] w-full max-w-md flex-col px-5 sm:px-6">
        {/* 顶部细规线 + 刊号行（杂志框架） */}
        <header className="border-t border-foreground/40 pt-3">
          <div className="flex items-baseline justify-between text-[10.5px] uppercase tracking-[0.28em] text-foreground/75">
            <span>FANLAI · 登录</span>
            <span suppressHydrationWarning>{dateLabel}</span>
          </div>
          <div className="mt-2.5 border-t border-foreground/15" />
        </header>

        {/* 中央刊头 */}
        <main className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <motion.div variants={stack} initial="hidden" animate="show" className="w-full">
            <motion.div variants={rise} className="flex justify-center">
              <FanLaiLogo size={72} animated />
            </motion.div>

            <motion.h1
              variants={rise}
              className="font-masthead mt-6 text-6xl font-black leading-none tracking-[0.06em]"
            >
              饭来
            </motion.h1>

            <motion.div
              variants={rise}
              className="mt-5 flex items-center justify-center gap-3 text-[10.5px] uppercase tracking-[0.32em] text-foreground/70"
            >
              <span className="h-px w-10 bg-foreground/25" />
              <span>Sign in</span>
              <span className="h-px w-10 bg-foreground/25" />
            </motion.div>

            <motion.p variants={rise} className="mt-4 text-sm text-muted-foreground">
              登录之后，饭来更懂你
            </motion.p>

            {/* 三种登录方式 */}
            <motion.div variants={rise} className="mt-9 space-y-3 text-left">
              {OPTIONS.map((opt) => {
                const active = mode === opt.key
                return (
                  <div key={opt.key}>
                    <button
                      type="button"
                      onClick={() => toggle(opt.key)}
                      className={`flex min-h-[56px] w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                        active
                          ? "border-[var(--crimson)] bg-white/60 dark:bg-white/[0.05]"
                          : "border-foreground/15 hover:border-foreground/40"
                      }`}
                      aria-expanded={active}
                    >
                      <span>
                        <span className="font-masthead block text-lg leading-snug">
                          {opt.title}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {opt.desc}
                        </span>
                      </span>
                      {opt.badge ? (
                        <Badge
                          variant="outline"
                          className="shrink-0 border-[var(--crimson)]/50 text-[10.5px] tracking-[0.14em] text-[var(--crimson)]"
                        >
                          {opt.badge}
                        </Badge>
                      ) : (
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                      )}
                    </button>

                    {/* 展开的登录面板 */}
                    <AnimatePresence initial={false}>
                      {active && (
                        <Panel key={`${opt.key}-panel`}>
                          {opt.key === "wechat" ? (
                            <WechatPanel onLoggedIn={onLoggedIn} />
                          ) : (
                            <CodeLoginPanel
                              provider={opt.key}
                              onLoggedIn={onLoggedIn}
                            />
                          )}
                        </Panel>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
            </motion.div>
          </motion.div>
        </main>

        {/* 底部：免登录入口 */}
        <footer className="pb-7 pt-2">
          <div className="border-t border-foreground/15 pt-1" />
          <div className="flex justify-center">
            <button
              type="button"
              onClick={onGuest}
              className="flex h-11 items-center gap-1.5 px-4 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              <ArrowLeft className="size-4" />
              先逛逛，不登录
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
