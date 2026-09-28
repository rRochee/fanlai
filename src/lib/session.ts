import { cookies } from "next/headers"
import { randomUUID } from "crypto"
import { db } from "@/lib/db"

/**
 * 饭来登录态 · 会话与演示验证码工具（仅服务端使用）
 *
 * 演示环境说明：
 * - 邮箱 / 智谱账号登录采用「验证码」方式，验证码存内存、由 /api/auth/code
 *   直接随响应返回给前端展示（生产环境应收进邮件，绝不回传响应体）。
 * - 微信扫码为演示模拟：/api/auth/wechat-qr 签发 qrId（内存记录），
 *   前端用「模拟扫码成功」按钮代替真实扫码。
 */

// 会话 cookie 名（httpOnly）
export const SESSION_COOKIE = "fanlai_session"

// 会话有效期：30 天
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

// 前端可见的用户形状（industries 已解析为数组）
export type SessionUser = {
  id: string
  email: string
  name: string
  provider: string // email / zhipu / wechat
  avatar: string
  industries: string[]
  pushTime: string
  channelEmail: boolean
  channelWechat: boolean
  onboarded: boolean
}

// Prisma User 行 → SessionUser（industries JSON 字符串 → string[]）
export function toSessionUser(user: {
  id: string
  email: string
  name: string
  provider: string
  avatar: string
  industries: string
  pushTime: string
  channelEmail: boolean
  channelWechat: boolean
  onboarded: boolean
}): SessionUser {
  let industries: string[] = []
  try {
    const parsed = JSON.parse(user.industries)
    if (Array.isArray(parsed)) {
      industries = parsed.filter((s): s is string => typeof s === "string")
    }
  } catch {
    // 解析失败保持空数组（默认值即合法 JSON，理论不会走到）
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    provider: user.provider,
    avatar: user.avatar,
    industries,
    pushTime: user.pushTime,
    channelEmail: user.channelEmail,
    channelWechat: user.channelWechat,
    onboarded: user.onboarded,
  }
}

// ---------- 会话管理 ----------

// 创建会话：随机 token 写库（30 天），并下发 httpOnly cookie
export async function createSession(userId: string) {
  const token = `${randomUUID()}${randomUUID()}`
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.session.create({ data: { token, userId, expiresAt } })

  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    // 生产环境建议 secure: true；沙箱为 http 演示，保持关闭以免 cookie 被丢弃
  })
  return token
}

// 读取当前会话用户：cookie → Session（含 user，校验 expiresAt）→ user 或 null
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null

  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  })
  if (!session) return null

  // 过期会话顺手删除（演示环境不设后台清扫，读到即清）
  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {})
    return null
  }

  return toSessionUser(session.user)
}

// 注销：删 DB 会话记录 + 清 cookie
export async function destroySession() {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (token) {
    await db.session.deleteMany({ where: { token } }).catch(() => {})
  }
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
}

// ---------- 邮箱验证码（内存存储，一次性消费） ----------

const CODE_TTL_MS = 10 * 60 * 1000 // 验证码 10 分钟有效
const codeStore = new Map<string, { code: string; expiresAt: number }>()

// 内存超过 500 条时清理过期项（防演示环境长期跑内存膨胀）
function pruneCodes() {
  if (codeStore.size <= 500) return
  const now = Date.now()
  for (const [k, v] of codeStore) {
    if (v.expiresAt < now) codeStore.delete(k)
  }
}

// 生成 6 位数字验证码，10 分钟有效（演示环境不真发邮件）
export function setCode(email: string): string {
  pruneCodes()
  const code = String(Math.floor(100000 + Math.random() * 900000))
  codeStore.set(email.toLowerCase(), { code, expiresAt: Date.now() + CODE_TTL_MS })
  return code
}

// 校验并消费验证码（一次性：无论对错，命中即取走；错误返回 false）
export function verifyCode(email: string, code: string): boolean {
  const key = email.toLowerCase()
  const rec = codeStore.get(key)
  if (!rec) return false
  if (rec.expiresAt < Date.now()) {
    codeStore.delete(key)
    return false
  }
  if (rec.code !== code) return false
  codeStore.delete(key)
  return true
}

// ---------- 微信扫码演示（内存签发记录） ----------

const QR_TTL_MS = 5 * 60 * 1000 // 二维码 5 分钟有效
const qrStore = new Map<string, { expiresAt: number }>()

function pruneQrs() {
  if (qrStore.size <= 500) return
  const now = Date.now()
  for (const [k, v] of qrStore) {
    if (v.expiresAt < now) qrStore.delete(k)
  }
}

// 签发 qrId（演示用伪二维码的种子，5 分钟有效）
export function issueWechatQr(): string {
  pruneQrs()
  const qrId = randomUUID()
  qrStore.set(qrId, { expiresAt: Date.now() + QR_TTL_MS })
  return qrId
}

// 消费 qrId：仅接受本服务签发且未过期的（扫码登录成功即作废）
export function consumeWechatQr(qrId: string): boolean {
  const rec = qrStore.get(qrId)
  if (!rec) return false
  qrStore.delete(qrId)
  return rec.expiresAt >= Date.now()
}
