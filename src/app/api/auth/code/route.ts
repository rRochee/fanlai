import { NextRequest, NextResponse } from "next/server"
import { setCode } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// 宽松邮箱格式校验（本地部分 @ 域名，域名至少含一个点）
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * POST /api/auth/code —— 发送邮箱验证码
 * body: { email }
 * 演示环境：验证码不真发邮件，直接以 devCode 随响应返回给前端展示；
 * 生产环境此处应改为调用邮件服务商发送，绝不把 code 放进响应体。
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : ""

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { ok: false, error: "邮箱格式看起来不太对，再检查一下？" },
      { status: 400 }
    )
  }

  const code = setCode(email)
  return NextResponse.json({ ok: true, devCode: code })
}
