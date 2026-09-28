import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { parseDateStr, shanghaiToday, shiftDateStr, toShanghaiDateStr } from "@/lib/date"

export const dynamic = "force-dynamic"

/**
 * 投递日历数据源：公司网申截止时间按月聚合。
 * 数据可信度分层（用户核心关切：网上来源不一）——
 * - sourceType/sourceName：官网来源 > 招聘平台转载（实习僧/牛客等）> 公众号/高校转发
 * - deadlineConfirmedAt：用户亲自到官网核对后打上的确认戳；null 表示仍是情报整理值
 * - 绝不编造：deadline 为 null 的企业不进日历，只进「缺截止情报」提示区
 */

// GET /api/deadlines?month=YYYY-MM&season=秋招
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const today = shanghaiToday()
  const monthRaw = sp.get("month") ?? today.slice(0, 7)
  const month = /^\d{4}-\d{2}$/.test(monthRaw) ? monthRaw : today.slice(0, 7)
  const seasonRaw = sp.get("season")?.trim() ?? ""
  const season = ["秋招", "春招", "社招"].includes(seasonRaw) ? seasonRaw : "秋招"

  const monthStart = parseDateStr(`${month}-01`)
  const monthEnd = new Date(monthStart)
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1)

  // 全量标量字段：条目要能直接喂给 CompanyDetail（点「详情」无缝打开）
  const rows = await db.company.findMany({
    where: { hidden: false, season, deadline: { not: null } },
    include: {
      applications: { orderBy: { updatedAt: "desc" }, select: { id: true, status: true, position: true, deadline: true } },
    },
  })

  const dayOf = (d: Date) => toShanghaiDateStr(d)
  const toItem = (c: (typeof rows)[number]) => {
    const { applications, ...rest } = c
    const primary = applications[0] ?? null
    return {
      ...rest,
      deadline: (c.deadline as Date).toISOString(),
      deadlineConfirmedAt: c.deadlineConfirmedAt ? c.deadlineConfirmedAt.toISOString() : null,
      application: primary,
      applicationCount: applications.length,
      publishedDay: toShanghaiDateStr(c.publishedAt),
    }
  }

  const items = rows
    .filter((c) => {
      const d = c.deadline as Date
      const day = dayOf(d)
      return day >= month && day < toShanghaiDateStr(monthEnd)
    })
    .sort((a, b) => {
      const da = (a.deadline as Date).getTime()
      const dbb = (b.deadline as Date).getTime()
      if (da !== dbb) return da - dbb
      return a.name.localeCompare(b.name, "zh")
    })
    .map(toItem)

  const counts = {
    inMonth: items.length,
    urgent3: rows.filter((c) => {
      const day = dayOf(c.deadline as Date)
      return day >= today && day <= shiftDateStr(today, 3)
    }).length,
    urgent7: rows.filter((c) => {
      const day = dayOf(c.deadline as Date)
      return day > shiftDateStr(today, 3) && day <= shiftDateStr(today, 7)
    }).length,
    expired: rows.filter((c) => dayOf(c.deadline as Date) < today).length,
    confirmed: rows.filter((c) => c.deadlineConfirmedAt != null).length,
    withDeadline: rows.length,
    noDlCount: 0,
  }

  // 未来 7 天清单（跨月，含下月头几天）：侧栏倒计时用
  const upcoming = rows
    .filter((c) => {
      const day = dayOf(c.deadline as Date)
      return day >= today && day <= shiftDateStr(today, 7)
    })
    .sort((a, b) => (a.deadline as Date).getTime() - (b.deadline as Date).getTime())
    .map(toItem)

  // 缺截止情报：同季未隐藏企业总数 - 有截止数；星标缺截止的单独列出（最该补全的一批）
  const [seasonTotal, starredNoDlRows] = await Promise.all([
    db.company.count({ where: { hidden: false, season } }),
    db.company.findMany({
      where: { hidden: false, season, starred: true, deadline: null },
      select: { id: true, name: true, industry: true, recruitUrl: true },
      take: 8,
      orderBy: { name: "asc" },
    }),
  ])
  counts.noDlCount = Math.max(0, seasonTotal - rows.length)

  // ── 官网可达性探测汇总（机器核验的一半：域名活着；截止日期本身仍需人工到官网确认）──
  // 分组查询：每组一行 = 该状态的家数；MAX(urlCheckedAt) 用于"最近探测时间"
  const urlRows = await db.$queryRaw<{ urlStatus: string | null; m: number | null }[]>`
    SELECT "urlStatus", COUNT(*) AS n, MAX("urlCheckedAt") AS m FROM Company WHERE "recruitUrl" != '' GROUP BY "urlStatus"`
  const lastM = urlRows.reduce((acc, r) => Math.max(acc, r.m ? Number(r.m) : 0), 0)
  const countOf = (s: string | null) => Number(urlRows.find((r) => r.urlStatus === s)?.n ?? 0)
  const verify = {
    ok: countOf("ok"),
    soft: countOf("soft"),
    fail: countOf("fail"),
    unchecked: countOf(null),
    lastCheckedAt: lastM > 0 ? new Date(lastM).toISOString() : null,
  }

  // ── 核对推荐（今日核对打卡）：紧迫未亲核优先。≤3 天 → 不足扩到 ≤7 天 → 再不足取最近将到期的；
  //    同档内官网探测 ok/soft 优先（跳过去能打开，核对体验好）、先到期优先
  const rankUrl = (s: string | null | undefined) => (s === "ok" ? 0 : s === "soft" ? 1 : 2)
  const pickQueue = (fromDay: number, toDay: number) =>
    rows
      .filter((c) => {
        if (c.deadlineConfirmedAt) return false
        const day = dayOf(c.deadline as Date)
        return day >= shiftDateStr(today, fromDay) && day <= shiftDateStr(today, toDay)
      })
      .sort((a, b) => {
        const du = rankUrl(a.urlStatus) - rankUrl(b.urlStatus)
        if (du !== 0) return du
        return (a.deadline as Date).getTime() - (b.deadline as Date).getTime()
      })
      .slice(0, 3)
  let reviewQueue = pickQueue(0, 3)
  if (reviewQueue.length < 3) reviewQueue = [...reviewQueue, ...pickQueue(4, 7).slice(0, 3 - reviewQueue.length)]
  if (reviewQueue.length < 3) {
    reviewQueue = [
      ...reviewQueue,
      ...rows
        .filter((c) => !c.deadlineConfirmedAt && (c.deadline as Date).getTime() >= Date.now() - 86400e3)
        .sort((a, b) => (a.deadline as Date).getTime() - (b.deadline as Date).getTime())
        .slice(0, 3 - reviewQueue.length),
    ]
  }

  // ── 核对打卡动态：最近记录 + 近 30 天核对日期集合（前端算连续打卡天数）──
  const confirmedRows = rows
    .filter((c) => c.deadlineConfirmedAt)
    .sort((a, b) => (b.deadlineConfirmedAt as Date).getTime() - (a.deadlineConfirmedAt as Date).getTime())
  const recentConfirms = confirmedRows.slice(0, 6).map((c) => ({
    name: c.name,
    at: (c.deadlineConfirmedAt as Date).toISOString(),
  }))
  const windowStart = new Date(`${today}T00:00:00.000Z`).getTime() - 29 * 86400e3
  const confirmDates = [
    ...new Set(
      confirmedRows
        .filter((c) => (c.deadlineConfirmedAt as Date).getTime() >= windowStart)
        .map((c) => dayOf(c.deadlineConfirmedAt as Date))
    ),
  ].sort()

  return NextResponse.json({
    month,
    today,
    items,
    counts,
    upcoming,
    starredNoDl: starredNoDlRows,
    verify,
    reviewQueue,
    recentConfirms,
    confirmDates,
  })
}

// PATCH /api/deadlines — 用户核对后的确认 / 修正（投递日历的可信度闭环）
// body: { id, confirm: true } 打确认戳 | { id, confirm: false } 撤销确认
//       { id, deadline: "YYYY-MM-DD" } 官网查到不同日期时修正（修正即视为已核对）
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const id = body && typeof body.id === "string" ? body.id : ""
  if (!id) return NextResponse.json({ error: "缺少企业 id" }, { status: 400 })

  const current = await db.company.findUnique({
    where: { id },
    select: { id: true, name: true, deadline: true },
  })
  if (!current) return NextResponse.json({ error: "企业不存在" }, { status: 404 })

  const data: { deadlineConfirmedAt?: Date | null; deadline?: Date } = {}

  if (typeof body.confirm === "boolean") {
    data.deadlineConfirmedAt = body.confirm ? new Date() : null
  }
  if (typeof body.deadline === "string") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.deadline)) {
      return NextResponse.json({ error: "日期格式应为 YYYY-MM-DD" }, { status: 400 })
    }
    data.deadline = parseDateStr(body.deadline)
    // 亲手修正过日期 = 已经在官网核对过
    data.deadlineConfirmedAt = new Date()
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "缺少有效字段（confirm / deadline）" }, { status: 400 })
  }

  const updated = await db.company.update({
    where: { id },
    data,
    select: { id: true, name: true, deadline: true, deadlineConfirmedAt: true },
  })
  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    deadline: updated.deadline?.toISOString() ?? null,
    deadlineConfirmedAt: updated.deadlineConfirmedAt?.toISOString() ?? null,
  })
}
