import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { isVerifyRoundRunning, runVerifyRound, verifyStats } from "@/lib/url-verify"

export const dynamic = "force-dynamic"

// GET /api/verify — 官网核验汇总（ok/soft/fail/unchecked + 最近核验时间）+ 最近 10 条核验记录
// 注：recent 查询用 $queryRaw（urlStatus / urlCheckedAt 是新列，运行中 dev server 的旧
// Prisma client DMMF 不认识，raw SQL 直读 SQLite 真实列，与 verifyStats 同一策略）。
export async function GET() {
  try {
    const stats = await verifyStats()
    const rows = await db.$queryRaw<{ name: string; urlStatus: string | null; urlCheckedAt: number | null }[]>`
      SELECT name, "urlStatus", "urlCheckedAt" FROM Company
      WHERE "urlCheckedAt" IS NOT NULL
      ORDER BY "urlCheckedAt" DESC
      LIMIT 10`
    const recent = rows.map((r) => ({
      name: r.name,
      urlStatus: r.urlStatus,
      urlCheckedAt: r.urlCheckedAt ? new Date(r.urlCheckedAt).toISOString() : null,
    }))
    return NextResponse.json({ ...stats, running: isVerifyRoundRunning(), recent })
  } catch (e) {
    return NextResponse.json({ error: `核验统计读取失败：${(e as Error).message.slice(0, 120)}` }, { status: 500 })
  }
}

// POST /api/verify — 触发一轮核验，立即返回 202；已有核验轮在跑时返回 409。
// 默认增量 limit 24；可选 body { "limit": N } 指定增量家数、{ "full": true } 全量（limit 0）。
// 核验为长耗时网络操作（并发 2 + 间隔限流），同 sync 一样「立即受理 + 后台执行」；
// 结果通过 GET /api/verify 观察（urlStatus / urlCheckedAt 落库）。
export async function POST(req: Request) {
  if (isVerifyRoundRunning()) {
    return NextResponse.json({ started: false, reason: "已有核验轮在跑，请稍后再试" }, { status: 409 })
  }
  const body = (await req.json().catch(() => ({}))) as { limit?: unknown; full?: unknown }
  const full = body?.full === true
  const limit = typeof body?.limit === "number" && Number.isFinite(body.limit) ? Math.max(0, Math.floor(body.limit)) : 24
  // 后台执行：不 await，让请求立即返回；runVerifyRound 内部全链路 try/catch，异常只记日志
  void runVerifyRound(full ? { limit: 0, full: true } : { limit }).catch((e) => {
    console.warn(`[url-verify] 后台核验轮异常：${(e as Error).message.slice(0, 160)}`)
  })
  return NextResponse.json({ started: true, mode: full ? "full" : `incremental:${limit}` }, { status: 202 })
}
