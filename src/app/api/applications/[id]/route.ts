import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { toShanghaiDateStr } from "@/lib/date"
import { appendHistory, parseHistory } from "@/lib/history"

export const dynamic = "force-dynamic"

// PATCH /api/applications/[id] — 更新状态/岗位/备注/渠道/截止日
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const data: Record<string, string | null> = {}
  if (typeof body.status === "string") data.status = body.status
  if (typeof body.position === "string") data.position = body.position.trim()
  if (typeof body.channel === "string") data.channel = body.channel.trim() || null
  if (typeof body.notes === "string") data.notes = body.notes.trim() || null

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 })
  }

  // 状态流转时追加轨迹（含首次直接 PATCH 建档的场景）
  if (typeof data.status === "string") {
    const current = await db.application.findUnique({ where: { id }, select: { history: true } })
    data.history = appendHistory(current?.history, data.status)
  }

  const saved = await db.application.update({
    where: { id },
    data,
    include: { company: true },
  })
  return NextResponse.json({
    ...saved,
    history: parseHistory(saved.history),
    company: { ...saved.company, publishedDay: toShanghaiDateStr(saved.company.publishedAt) },
  })
}

// DELETE /api/applications/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  await db.application.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
