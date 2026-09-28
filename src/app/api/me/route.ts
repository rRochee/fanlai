import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getSessionUser, toSessionUser } from "@/lib/session"
import { INDUSTRIES } from "@/lib/catalog"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const PUSH_TIMES = ["08:00", "12:00", "20:00"] as const
const INDUSTRY_SET = new Set<string>(INDUSTRIES)

/**
 * GET /api/me —— 当前登录用户（industries 已解析为数组）
 * 未登录返回 401；已登录返回 { user }
 */
export async function GET() {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 })
  }
  return NextResponse.json({ ok: true, user })
}

/**
 * PUT /api/me —— 更新当前用户的定制偏好（部分字段可选，仅更新传入项）
 * body: { name?, avatar?, industries?, pushTime?, channelEmail?, channelWechat?, onboarded? }
 * - name：1~20 字
 * - avatar：≤8 字符（emoji）
 * - industries：字符串数组，且每一项都在 18 个行业枚举内
 * - pushTime：∈ ["08:00", "12:00", "20:00"]
 * - channelEmail / channelWechat / onboarded：布尔
 */
export async function PUT(req: NextRequest) {
  const current = await getSessionUser()
  if (!current) {
    return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "请求体格式不对" }, { status: 400 })
  }

  const data: Record<string, unknown> = {}

  // 昵称：1~20 字
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (name.length < 1 || name.length > 20) {
      return NextResponse.json(
        { ok: false, error: "昵称需要 1~20 个字" },
        { status: 400 }
      )
    }
    data.name = name
  }

  // 头像 emoji：≤8 字符
  if (body.avatar !== undefined) {
    const avatar = typeof body.avatar === "string" ? body.avatar.trim() : ""
    if (avatar.length < 1 || avatar.length > 8) {
      return NextResponse.json(
        { ok: false, error: "头像得是一个 emoji 呀" },
        { status: 400 }
      )
    }
    data.avatar = avatar
  }

  // 目标行业：字符串数组，每项都在 18 行业枚举内
  if (body.industries !== undefined) {
    const industries = body.industries
    if (
      !Array.isArray(industries) ||
      industries.some((s) => typeof s !== "string" || !INDUSTRY_SET.has(s))
    ) {
      return NextResponse.json(
        { ok: false, error: "目标行业里有不认识的选项" },
        { status: 400 }
      )
    }
    data.industries = JSON.stringify([...new Set(industries)])
  }

  // 每日推送时间
  if (body.pushTime !== undefined) {
    if (typeof body.pushTime !== "string" || !PUSH_TIMES.includes(body.pushTime as never)) {
      return NextResponse.json(
        { ok: false, error: "推送时间只能是 08:00 / 12:00 / 20:00" },
        { status: 400 }
      )
    }
    data.pushTime = body.pushTime
  }

  // 推送渠道 / 引导完成标记（布尔）
  for (const key of ["channelEmail", "channelWechat", "onboarded"] as const) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== "boolean") {
        return NextResponse.json(
          { ok: false, error: `${key} 应为布尔值` },
          { status: 400 }
        )
      }
      data[key] = body[key]
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: false, error: "没有可更新的字段" }, { status: 400 })
  }

  const user = await db.user.update({ where: { id: current.id }, data })
  return NextResponse.json({ ok: true, user: toSessionUser(user) })
}
