import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import {
  createSession,
  verifyCode,
  consumeWechatQr,
  toSessionUser,
} from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// 宽松邮箱格式校验
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * POST /api/auth/login —— 三种方式登录（成功均建立会话 cookie）
 *
 * - { provider: "email",  email, code } → 验证码通过后 upsert 用户（provider="email"，昵称默认邮箱前缀）
 * - { provider: "zhipu",  email, code } → 同 email 流程（智谱账号演示：验证码同渠道下发，provider="zhipu"）
 * - { provider: "wechat", qrId }        → 校验 qrId 为本服务签发后 upsert 用户
 *     （email = wx-{qrId 前 8 位}@fanlai.local，昵称「微信饭友」，provider="wechat"）
 *
 * 成功返回 { ok: true, user }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const provider = typeof body?.provider === "string" ? body.provider : ""

  // ① 邮箱验证码 / ② 智谱账号（演示环境两种走同一验证码渠道）
  if (provider === "email" || provider === "zhipu") {
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : ""
    const code = typeof body?.code === "string" ? body.code.trim() : ""

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json(
        { ok: false, error: "邮箱格式看起来不太对，再检查一下？" },
        { status: 400 }
      )
    }
    if (!code) {
      return NextResponse.json({ ok: false, error: "请输入验证码" }, { status: 400 })
    }
    if (!verifyCode(email, code)) {
      return NextResponse.json(
        { ok: false, error: "验证码不对或已过期，重新获取试试" },
        { status: 400 }
      )
    }

    // upsert：邮箱唯一，同一邮箱重复登录复用同一账号（保留已定制的昵称/偏好）
    const user = await db.user.upsert({
      where: { email },
      create: {
        email,
        name: email.split("@")[0] || "饭友", // 昵称默认取邮箱前缀
        provider,
      },
      update: {}, // 已有账号：不动昵称与偏好
    })

    await createSession(user.id)
    return NextResponse.json({ ok: true, user: toSessionUser(user) })
  }

  // ③ 微信扫码（演示：qrId 为本服务内存签发）
  if (provider === "wechat") {
    const qrId = typeof body?.qrId === "string" ? body.qrId : ""
    if (!qrId || !consumeWechatQr(qrId)) {
      return NextResponse.json(
        { ok: false, error: "二维码无效或已过期，请刷新后重试" },
        { status: 400 }
      )
    }

    // 虚拟邮箱：wx-{qrId 前 8 位}@fanlai.local（qrId 一次性消费，故基本每次扫码都是新号）
    const email = `wx-${qrId.slice(0, 8)}@fanlai.local`
    const user = await db.user.upsert({
      where: { email },
      create: { email, name: "微信饭友", provider: "wechat" },
      update: {}, // 同一虚拟邮箱再次命中时保持幂等
    })

    await createSession(user.id)
    return NextResponse.json({ ok: true, user: toSessionUser(user) })
  }

  return NextResponse.json({ ok: false, error: "不支持的登录方式" }, { status: 400 })
}
