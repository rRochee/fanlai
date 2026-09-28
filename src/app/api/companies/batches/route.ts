import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { toShanghaiDateStr, shanghaiToday, shiftDateStr } from "@/lib/date"

export const dynamic = "force-dynamic"

const SEASONS = ["秋招", "春招", "社招"] as const

// GET /api/companies/batches?season= — 按放出日聚合计数（近14天 + 全部日期）
export async function GET(req: NextRequest) {
  const seasonRaw = req.nextUrl.searchParams.get("season")?.trim() ?? ""
  const season = (SEASONS as readonly string[]).includes(seasonRaw) ? seasonRaw : ""

  const grouped = await db.company.groupBy({
    by: ["publishedAt"],
    _count: { _all: true },
    where: { hidden: false, ...(season ? { season } : {}) },
    orderBy: { publishedAt: "desc" },
  })

  const today = shanghaiToday()

  const all = grouped.map((g) => ({
    date: toShanghaiDateStr(g.publishedAt),
    count: g._count._all,
  }))

  // 近 14 天的连续日期轴（含无批次的日子）
  const recent: { date: string; count: number; isToday: boolean }[] = []
  for (let i = 13; i >= 0; i--) {
    const d = shiftDateStr(today, -i)
    recent.push({
      date: d,
      count: all.find((a) => a.date === d)?.count ?? 0,
      isToday: d === today,
    })
  }

  return NextResponse.json({ today, all, recent, season: season || "秋招" })
}
