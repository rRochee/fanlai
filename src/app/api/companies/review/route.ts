import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

const SEASONS = ["秋招", "春招", "社招"] as const

// POST /api/companies/review
// body: { action: "confirm" | "ignore" | "restore", id?, all?, season? }
// - confirm: 待核 → 已核（verified=true）
// - ignore:  忽略待核条目（hidden=true，不再出现在今日/名录）
// - restore: 恢复已忽略条目（hidden=false）
// - all=true 时批量作用于（该季）全部 verified=false & hidden=false 的条目
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const action = body?.action
  if (!["confirm", "ignore", "restore"].includes(action)) {
    return NextResponse.json({ error: "action 必须为 confirm / ignore / restore" }, { status: 400 })
  }

  const seasonRaw = typeof body?.season === "string" ? body.season : ""
  const season = (SEASONS as readonly string[]).includes(seasonRaw) ? seasonRaw : ""

  // 组装 where：单条（id）或批量（all + season）
  // restore 批量面向「已隐藏」条目；confirm/ignore 批量面向「未隐藏的待核」条目
  let where: Record<string, unknown>
  if (typeof body?.id === "string" && body.id) {
    where = { id: body.id }
  } else if (body?.all === true) {
    where =
      action === "restore"
        ? { hidden: true }
        : { verified: false, hidden: false }
    if (season) where.season = season
  } else {
    return NextResponse.json({ error: "缺少 id 或 all=true" }, { status: 400 })
  }

  const data =
    action === "confirm"
      ? { verified: true, hidden: false }
      : action === "ignore"
        ? { hidden: true }
        : { hidden: false }

  // confirm/ignore 只作用于待核条目；restore 面向已忽略条目（含已核，可恢复）
  if (action !== "restore") {
    where.verified = false
  } else {
    delete where.verified
  }

  const result = await db.company.updateMany({ where, data })
  if (result.count === 0) {
    return NextResponse.json({ updated: 0, message: "没有符合条件的条目" })
  }

  const actionWord = action === "confirm" ? "已确认收录" : action === "ignore" ? "已忽略" : "已恢复显示"
  return NextResponse.json({
    updated: result.count,
    message: `${actionWord} ${result.count} 条`,
  })
}
