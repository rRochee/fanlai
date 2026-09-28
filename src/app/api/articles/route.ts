import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

// GET /api/articles?limit=50 — 最近抓取的搜狗微信文章池（SourceArticle，管理端可见）
// 返回按抓取时间倒序的文章列表（含企业匹配状态：new=未命中留待人工 / matched=已命中企业）
export async function GET(req: NextRequest) {
  const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "50")
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100) : 50
  const status = req.nextUrl.searchParams.get("status")?.trim() ?? ""

  const where = ["new", "matched", "ignored"].includes(status) ? { status } : {}
  const [items, total] = await Promise.all([
    db.sourceArticle.findMany({
      where,
      orderBy: { fetchedAt: "desc" },
      take: limit,
    }),
    db.sourceArticle.count({ where }),
  ])

  return NextResponse.json({ items, total, limit })
}
