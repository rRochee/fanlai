import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { toShanghaiDateStr } from "@/lib/date"

export const dynamic = "force-dynamic"

// PATCH /api/companies/[id] — 星标切换 / 清单置顶 / AI 情报确认收录 / 忽略与恢复
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const data: { starred?: boolean; pinned?: boolean; verified?: boolean; hidden?: boolean } = {}

  if (typeof body.starred === "boolean") {
    data.starred = body.starred
  }
  if (typeof body.pinned === "boolean") {
    data.pinned = body.pinned
  }
  // 确认收录：仅允许 待核 → 已核（不允许反向，保证已核目录不被误降级）
  if (body.verify === true) {
    const current = await db.company.findUnique({ where: { id }, select: { verified: true } })
    if (!current) return NextResponse.json({ error: "企业不存在" }, { status: 404 })
    if (!current.verified) data.verified = true
  }
  // 忽略 / 恢复：隐藏或找回条目（忽略仅限待核条目，避免误伤已核目录）
  if (typeof body.hidden === "boolean") {
    if (body.hidden) {
      const current = await db.company.findUnique({ where: { id }, select: { verified: true } })
      if (!current) return NextResponse.json({ error: "企业不存在" }, { status: 404 })
      if (current.verified) {
        return NextResponse.json({ error: "已核目录条目不可忽略" }, { status: 400 })
      }
      data.hidden = true
    } else {
      data.hidden = false
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "缺少有效字段（starred / pinned / verify / hidden）" }, { status: 400 })
  }

  const company = await db.company.update({
    where: { id },
    data,
    include: {
      applications: { orderBy: { updatedAt: "desc" }, select: { id: true, status: true, position: true, deadline: true } },
    },
  })
  const { applications, ...rest } = company
  const primary = applications[0] ?? null
  return NextResponse.json({
    ...rest,
    application: primary,
    applicationCount: applications.length,
    publishedDay: toShanghaiDateStr(company.publishedAt),
  })
}
