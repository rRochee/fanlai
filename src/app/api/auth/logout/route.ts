import { NextResponse } from "next/server"
import { destroySession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// POST /api/auth/logout —— 注销：删 DB 会话 + 清 cookie
export async function POST() {
  await destroySession()
  return NextResponse.json({ ok: true })
}
