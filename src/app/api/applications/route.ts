import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { toShanghaiDateStr } from "@/lib/date"
import { appendHistory, parseHistory } from "@/lib/history"

export const dynamic = "force-dynamic"

// GET /api/applications — 投递记录（含企业信息；同一企业可多条，每条一个岗位）
export async function GET() {
  const items = await db.application.findMany({
    orderBy: { updatedAt: "desc" },
    include: { company: true },
  })
  // company 附带 publishedDay（详情侧滑日期渲染依赖）；history 反序列化为轨迹数组
  // 存量记录无轨迹时，用建档时间合成首个节点，保证时间线至少可见
  return NextResponse.json({
    items: items.map((a) => {
      const history = parseHistory(a.history)
      return {
        ...a,
        history:
          history.length > 0
            ? history
            : [{ status: a.status, at: (a.appliedAt ?? a.updatedAt).toISOString() }],
        company: { ...a.company, publishedDay: toShanghaiDateStr(a.company.publishedAt) },
      }
    }),
  })
}

// POST /api/applications — 新增或更新某企业的投递记录
// 多岗位语义：同一企业按岗位名去重——同岗位名 → 更新该条；新岗位名 → 新建一条
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body?.companyId) {
    return NextResponse.json({ error: "缺少 companyId" }, { status: 400 })
  }
  const company = await db.company.findUnique({ where: { id: body.companyId } })
  if (!company) {
    return NextResponse.json({ error: "企业不存在" }, { status: 404 })
  }

  // deadline：前端传 YYYY-MM-DD（或完整 ISO），落库为上海时间当日 23:59 的 UTC
  let deadline: Date | null = null
  const rawDeadline = typeof body.deadline === "string" ? body.deadline.trim() : ""
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDeadline)) {
    const d = new Date(`${rawDeadline}T23:59:59+08:00`)
    if (!Number.isNaN(d.getTime())) deadline = d
  } else if (rawDeadline) {
    const d = new Date(rawDeadline)
    if (!Number.isNaN(d.getTime())) deadline = d
  }

  const status = (body.status as string | undefined) || "已投递"
  const position = (body.position as string | undefined)?.trim() || "待定岗位"
  const data = {
    position,
    status,
    channel: (body.channel as string | undefined)?.trim() || null,
    notes: (body.notes as string | undefined)?.trim() || null,
    deadline,
  }

  // 同岗位匹配（忽略首尾空格与大小写，兼容中英文岗位名）
  const norm = (s: string) => s.trim().toLowerCase()
  const companyApps = await db.application.findMany({
    where: { companyId: body.companyId },
    select: { id: true, position: true, history: true },
  })
  const samePosition = companyApps.find((a) => norm(a.position) === norm(position))

  const saved = samePosition
    ? await db.application.update({
        where: { id: samePosition.id },
        // 更新：状态变化（或同状态重存刷新时间）追加轨迹
        data: { ...data, history: appendHistory(samePosition.history, status) },
        include: { company: true },
      })
    : await db.application.create({
        // 新建：轨迹从当前状态起步
        data: { companyId: body.companyId, ...data, history: appendHistory(null, status) },
        include: { company: true },
      })

  return NextResponse.json({
    ...saved,
    created: !samePosition,
    history: parseHistory(saved.history),
    company: { ...saved.company, publishedDay: toShanghaiDateStr(saved.company.publishedAt) },
  })
}
