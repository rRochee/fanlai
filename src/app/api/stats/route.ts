import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { shanghaiToday, parseDateStr } from "@/lib/date"

export const dynamic = "force-dynamic"

const SEASONS = ["秋招", "春招", "社招"] as const

// GET /api/stats?season= — 顶部统计条（企业侧统计按季节过滤；投递记录跨季节保留）
export async function GET(req: NextRequest) {
  const seasonRaw = req.nextUrl.searchParams.get("season")?.trim() ?? ""
  const season = (SEASONS as readonly string[]).includes(seasonRaw) ? seasonRaw : ""

  const today = shanghaiToday()
  const dayStart = parseDateStr(today)

  const companyWhere = season ? { season } : {}
  const [total, todayCount, starred, applications, focusCount, pendingReview, hiddenCount, syncLogRow] =
    await Promise.all([
      db.company.count({ where: { ...companyWhere, hidden: false } }),
      db.company.count({
        where: { ...companyWhere, hidden: false, publishedAt: { gte: dayStart } },
      }),
      db.company.count({ where: { ...companyWhere, hidden: false, starred: true } }),
      db.application.groupBy({ by: ["status"], _count: { _all: true } }),
      db.company.count({ where: { ...companyWhere, hidden: false, tags: { contains: "科技" } } }),
      db.company.count({ where: { ...companyWhere, verified: false, hidden: false } }),
      db.company.count({ where: { ...companyWhere, hidden: true } }),
      db.setting.findUnique({ where: { key: "lastSyncLog" } }),
    ])

  // 今日新增公众号文章数（搜狗微信直搜管道 SourceArticle；可选字段，失败不破坏现有 stats 消费方）
  let articles = 0
  try {
    articles = await db.sourceArticle.count({ where: { fetchedAt: { gte: dayStart } } })
  } catch {
    articles = 0
  }

  const byStatus: Record<string, number> = {}
  let appliedTotal = 0
  let upcomingDeadline = 0
  for (const row of applications) {
    byStatus[row.status] = row._count._all
    appliedTotal += row._count._all
  }

  // 未来 7 天内到期的投递节点数（全季节，属于用户自己的日程）
  const weekLater = new Date(dayStart.getTime() + 7 * 24 * 3600 * 1000)
  upcomingDeadline = await db.application.count({
    where: { deadline: { gte: dayStart, lte: weekLater } },
  })

  // 最近一次情报同步日志（手动 / 自动共用）
  let lastSync: { at: string; added: number; refreshed: number; source: string; season: string } | null =
    null
  if (syncLogRow?.value) {
    try {
      const parsed = JSON.parse(syncLogRow.value) as {
        at?: string
        added?: number
        refreshed?: number
        source?: string
        season?: string
      }
      if (parsed?.at) {
        lastSync = {
          at: parsed.at,
          added: parsed.added ?? 0,
          refreshed: parsed.refreshed ?? 0,
          source: parsed.source === "auto" ? "auto" : "manual",
          season: parsed.season ?? "秋招",
        }
      }
    } catch {
      lastSync = null
    }
  }

  return NextResponse.json({
    today,
    total,
    todayCount,
    starred,
    focusCount,
    pendingReview,
    hiddenCount,
    upcomingDeadline,
    season: season || "秋招",
    appliedTotal,
    byStatus,
    lastSync,
    // 今日新增公众号文章数（搜狗微信直搜管道；可选字段，旧消费方不读也不受影响）
    articles,
  })
}
