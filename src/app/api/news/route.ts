import { NextRequest, NextResponse } from "next/server"
import {
  isNewsRunning,
  listNews,
  newsJobSnapshot,
  newsPoolStats,
  runNewsJob,
} from "@/lib/news-job"

export const dynamic = "force-dynamic"

// GET /api/news — 行业情报列表（饭来情报站，Task 28-e）
// ?category= 分类过滤（缺省全部）；?limit= 条数（默认 30，上限 100）。
// 按 publishedAt（缺省 fetchedAt）倒序；附带池子统计与管道状态（前端轮询「实时感」用）。
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const rawCategory = sp.get("category")?.trim() ?? ""
    const category = rawCategory || null
    const limitRaw = Number(sp.get("limit") ?? 30)
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 30

    const rows = await listNews(category, limit)
    const stats = await newsPoolStats()
    const snap = newsJobSnapshot()

    return NextResponse.json({
      items: rows.map((r) => ({
        id: r.id,
        category: r.category,
        title: r.title,
        summary: r.summary,
        url: r.url,
        source: r.source,
        publishedAt: r.publishedAt ? new Date(r.publishedAt).toISOString() : null,
        fetchedAt: new Date(r.fetchedAt).toISOString(),
      })),
      total: stats.total,
      byCategory: stats.byCategory,
      lastFetchedAt: stats.lastFetchedAt ? new Date(stats.lastFetchedAt).toISOString() : null,
      running: snap.running,
      error: snap.error,
    })
  } catch (e) {
    return NextResponse.json(
      { error: `情报池读取失败：${(e as Error).message.slice(0, 120)}` },
      { status: 500 }
    )
  }
}

// POST /api/news — 手动触发一轮检索（模块级互斥；立即返回 202，后台执行，
// 结果通过 GET 观察，与 /api/verify 同款「受理 + 后台跑」模式）。
export async function POST() {
  if (isNewsRunning()) {
    return NextResponse.json({ started: false, reason: "已有情报轮在跑，请稍后再试" }, { status: 202 })
  }
  void runNewsJob().catch((e) => {
    console.warn(`[api/news] 后台情报轮异常：${(e as Error).message.slice(0, 160)}`)
  })
  return NextResponse.json({ started: true }, { status: 202 })
}
