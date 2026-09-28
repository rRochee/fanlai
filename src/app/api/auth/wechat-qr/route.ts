import { NextResponse } from "next/server"
import { issueWechatQr } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * GET /api/auth/wechat-qr —— 签发微信扫码演示二维码
 * 内存记录 { qrId, expiresAt(5 分钟) }；返回 { qrId, expiresIn: 300 }
 * 生产环境此处应返回真实微信 OAuth 跳转地址 / 微信托管的二维码图片。
 */
export async function GET() {
  const qrId = issueWechatQr()
  return NextResponse.json({ qrId, expiresIn: 300 })
}
