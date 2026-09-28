import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { toShanghaiDateStr, parseDateStr, shanghaiToday } from "@/lib/date"

export const dynamic = "force-dynamic"

export const SEASONS = ["秋招", "春招", "社招"] as const

// GET /api/companies?q=&industry=&industries=a,b,c=&tag=&date=&starred=&page=&pageSize=&sort=&season=
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const q = sp.get("q")?.trim() ?? ""
  const industry = sp.get("industry")?.trim() ?? ""
  // 多选行业（逗号分隔，取并集）；与单选 industry 共存时多选优先
  const industriesRaw = sp.get("industries")?.trim() ?? ""
  const industries = industriesRaw
    ? industriesRaw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12)
    : []
  const tag = sp.get("tag")?.trim() ?? ""
  const date = sp.get("date")?.trim() ?? ""
  const starred = sp.get("starred") === "1"
  const verified = sp.get("verified") // "0"=仅待核 "1"=仅已核
  const includeHidden = sp.get("includeHidden") === "1" // 含已忽略（找回/恢复用）
  const hasApp = sp.get("hasApp") === "1" // 仅有投递记录的企业
  const seasonRaw = sp.get("season")?.trim() ?? ""
  const season = (SEASONS as readonly string[]).includes(seasonRaw) ? seasonRaw : ""
  const sort = sp.get("sort") ?? "newest"
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1)
  const pageSize = Math.min(96, Math.max(6, parseInt(sp.get("pageSize") ?? "24", 10) || 24))

  const where: Record<string, unknown> = {}
  // 默认隐藏「已忽略」条目；名录勾选「含已忽略」时才返回
  if (!includeHidden) where.hidden = false
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { fullName: { contains: q } },
      { summary: { contains: q } },
      { description: { contains: q } },
      { industry: { contains: q } },
      { city: { contains: q } },
      { positions: { contains: q } },
    ]
  }
  if (season) where.season = season
  if (industries.length > 0) where.industry = { in: industries }
  else if (industry && industry !== "全部") where.industry = industry
  if (tag && tag !== "全部") where.tags = { contains: tag }
  if (starred) where.starred = true
  if (hasApp) where.applications = { some: {} }
  if (verified === "0") where.verified = false
  else if (verified === "1") where.verified = true
  if (date) {
    const dayStart = parseDateStr(date)
    where.publishedAt = {
      gte: dayStart,
      lt: new Date(dayStart.getTime() + 24 * 3600 * 1000),
    }
  }

  const orderBy =
    sort === "name"
      ? [{ name: "asc" as const }]
      : sort === "oldest"
        ? [{ publishedAt: "asc" as const }, { name: "asc" as const }]
        : [{ publishedAt: "desc" as const }, { name: "asc" as const }]

  // 「按截止日最近」：企业网申 DDL 或投递记录 DDL 取最近者升序排前，无 DDL 的按最新放出跟后。
  // SQLite/Prisma 无法在一条 orderBy 里表达「有 DDL 优先」，数据量小（百级），在内存中排序后按 id 取页。
  if (sort === "deadline") {
    const ts = (v: Date | null | undefined) => (v ? new Date(v).getTime() : Number.POSITIVE_INFINITY)
    const all = await db.company.findMany({
      where,
      select: { id: true, publishedAt: true, name: true, deadline: true, applications: { select: { deadline: true } } },
    })
    const pageIds = [...all]
      .sort((a, b) => {
        // 企业网申 DDL 与投递记录 DDL 取最近一个作为排序依据
        const da = Math.min(ts(a.deadline), ...a.applications.map((x) => ts(x.deadline)))
        const dbb = Math.min(ts(b.deadline), ...b.applications.map((x) => ts(x.deadline)))
        if (da !== dbb) return da - dbb
        const pa = new Date(a.publishedAt).getTime()
        const pb = new Date(b.publishedAt).getTime()
        if (pa !== pb) return pb - pa
        return a.name.localeCompare(b.name, "zh")
      })
      .slice((page - 1) * pageSize, page * pageSize)
      .map((c) => c.id)
    const [rows, total] = await Promise.all([
      db.company.findMany({
        where: { ...where, id: { in: pageIds } },
        include: {
          applications: { orderBy: { updatedAt: "desc" }, select: { id: true, status: true, position: true, deadline: true } },
        },
      }),
      db.company.count({ where }),
    ])
    const byId = new Map(rows.map((r) => [r.id, r]))
    const items = pageIds
      .map((id) => byId.get(id))
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
    return NextResponse.json({
      items: items.map(withPrimaryApp),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
      today: shanghaiToday(),
    })
  }

  const [items, total] = await Promise.all([
    db.company.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        applications: { orderBy: { updatedAt: "desc" }, select: { id: true, status: true, position: true, deadline: true } },
      },
    }),
    db.company.count({ where }),
  ])

  return NextResponse.json({
    items: items.map(withPrimaryApp),
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
    today: shanghaiToday(),
  })
}

/** 多岗位适配：返回 primary application（最近更新的一条，兼容既有 UI）+ 记录数 */
function withPrimaryApp<
  T extends {
    publishedAt: Date
    applications: { id: string; status: string; position: string; deadline: Date | null }[]
  },
>(c: T) {
  const { applications, ...rest } = c
  const primary = applications[0] ?? null
  return {
    ...rest,
    application: primary
      ? {
          id: primary.id,
          status: primary.status,
          position: primary.position,
          deadline: primary.deadline,
        }
      : null,
    applicationCount: applications.length,
    publishedDay: toShanghaiDateStr(c.publishedAt),
  }
}

// POST /api/companies — 手动补充企业（遗漏兜底入口）
// 用户发现名录漏掉了某家企业时自行录入：verified=true 直接进入已核目录
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "请求格式有误" }, { status: 400 })
  }

  const name = String((body as Record<string, unknown>).name ?? "").trim().slice(0, 30)
  const industry = String((body as Record<string, unknown>).industry ?? "").trim().slice(0, 12)
  const summary = String((body as Record<string, unknown>).summary ?? "").trim().slice(0, 40)
  if (!name) return NextResponse.json({ error: "请填写企业名" }, { status: 400 })
  if (!industry) return NextResponse.json({ error: "请选择行业" }, { status: 400 })
  if (!summary) return NextResponse.json({ error: "请填写一句话简介" }, { status: 400 })

  const seasonRaw = String((body as Record<string, unknown>).season ?? "秋招")
  const season = (SEASONS as readonly string[]).includes(seasonRaw) ? seasonRaw : "秋招"
  const city = String((body as Record<string, unknown>).city ?? "").trim().slice(0, 20) || "待核"
  const positionsRaw = String((body as Record<string, unknown>).positions ?? "")
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(",")
  const recruitUrlRaw = String((body as Record<string, unknown>).recruitUrl ?? "").trim().slice(0, 300)
  // 官网未填时降级为搜索引擎链接，保证「去官网找岗位」动线依然可用
  const recruitUrl =
    recruitUrlRaw && /^https?:\/\//.test(recruitUrlRaw)
      ? recruitUrlRaw
      : `https://www.bing.com/search?q=${encodeURIComponent(`${name} 招聘官网 校园招聘`)}`

  const existing = await db.company.findUnique({ where: { name } })
  if (existing) {
    return NextResponse.json(
      { error: `「${name}」已在名录中（${existing.season}批次）` },
      { status: 409 }
    )
  }

  const today = shanghaiToday()
  const created = await db.company.create({
    data: {
      name,
      industry,
      city,
      size: "待核",
      funding: "待核",
      summary,
      description: `本条由你于 ${today} 手动补充录入，直接进入已核目录。简介：${summary}。建议访问招聘官网核实岗位详情后投递。`,
      positions: positionsRaw || "待核",
      tags: "手动补充",
      recruitUrl,
      sourceType: "手动补充",
      sourceName: "本人录入",
      publishedAt: parseDateStr(today),
      season,
      verified: true,
    },
  })

  return NextResponse.json({ company: { id: created.id, name: created.name }, message: `已补充「${name}」进入今日名录` }, { status: 201 })
}
