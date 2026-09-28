import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { normalizeName } from "@/lib/utils"

export const dynamic = "force-dynamic"

// GET /api/backup — 全量导出（企业 + 投递记录），供用户本地备份
export async function GET() {
  const [companies, applications] = await Promise.all([
    db.company.findMany({ orderBy: { createdAt: "asc" } }),
    db.application.findMany({ orderBy: { appliedAt: "asc" } }),
  ])
  return NextResponse.json({
    format: "fanlai-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    counts: { companies: companies.length, applications: applications.length },
    companies,
    applications,
  })
}

interface BackupCompany {
  id?: string
  name: string
  fullName?: string | null
  industry?: string
  city?: string
  size?: string
  funding?: string
  summary?: string
  description?: string
  positions?: string
  tags?: string
  recruitUrl?: string
  sourceType?: string
  sourceName?: string
  publishedAt?: string
  season?: string
  starred?: boolean
  verified?: boolean
  hidden?: boolean
}

interface BackupApplication {
  id?: string
  companyName?: string
  companyId?: string
  position: string
  status?: string
  channel?: string | null
  notes?: string | null
  deadline?: string | null
  history?: string // 序列化 JSON 字符串（与库内存储格式一致）
  appliedAt?: string
}

// POST /api/backup — 合并导入：同名企业跳过（保留本地状态），新企业建档；
// 投递记录按「企业 + 岗位名」匹配，存在跳过，不存在补入（轨迹原样带回）
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const data = body?.data ?? body
  if (!data || data.format !== "fanlai-backup" || !Array.isArray(data.companies)) {
    return NextResponse.json({ error: "备份文件格式不正确（需要饭来导出的 JSON）" }, { status: 400 })
  }

  let companiesAdded = 0
  let companiesSkipped = 0
  let appsAdded = 0
  let appsSkipped = 0

  // 企业名 → 本地记录（含 id），供投递记录重映射
  const localCompanies = await db.company.findMany({ select: { id: true, name: true } })
  const byName = new Map(localCompanies.map((c) => [normalizeName(c.name), c]))

  // 备份内 companyId → 企业名（用于投递记录重映射）
  const idToName = new Map<string, string>()
  for (const raw of data.companies as BackupCompany[]) {
    if (raw.id && raw.name) idToName.set(raw.id, raw.name)
  }

  const nameToId = new Map<string, string>()
  for (const raw of data.companies as BackupCompany[]) {
    const name = (raw.name ?? "").trim()
    if (!name) {
      companiesSkipped++
      continue
    }
    const key = normalizeName(name)
    const existing = byName.get(key)
    if (existing) {
      nameToId.set(key, existing.id)
      companiesSkipped++
      continue
    }
    const publishedAt = raw.publishedAt ? new Date(raw.publishedAt) : new Date()
    try {
      const created = await db.company.create({
        data: {
          name,
          fullName: raw.fullName ?? null,
          industry: raw.industry ?? "其他行业",
          city: raw.city ?? "待核",
          size: raw.size ?? "待核",
          funding: raw.funding ?? "待核",
          summary: raw.summary ?? "备份恢复条目",
          description: raw.description ?? raw.summary ?? "",
          positions: raw.positions ?? "待核",
          tags: raw.tags ?? "",
          recruitUrl: raw.recruitUrl ?? "",
          sourceType: raw.sourceType ?? "备份恢复",
          sourceName: raw.sourceName ?? "本地备份",
          publishedAt: Number.isNaN(publishedAt.getTime()) ? new Date() : publishedAt,
          season: raw.season ?? "秋招",
          starred: raw.starred ?? false,
          verified: raw.verified ?? false,
          hidden: raw.hidden ?? false,
        },
        select: { id: true },
      })
      byName.set(key, { id: created.id, name })
      nameToId.set(key, created.id)
      companiesAdded++
    } catch {
      companiesSkipped++
    }
  }

  const applications = Array.isArray(data.applications) ? (data.applications as BackupApplication[]) : []
  for (const raw of applications) {
    const position = (raw.position ?? "").trim()
    if (!position) {
      appsSkipped++
      continue
    }
    // 备份内的 companyId → 企业名 → 本地企业 id；对不上则跳过
    const companyName = raw.companyName ?? (raw.companyId ? idToName.get(raw.companyId) : undefined)
    const companyId = companyName ? nameToId.get(normalizeName(companyName)) ?? "" : ""
    if (!companyId) {
      appsSkipped++
      continue
    }

    const siblings = await db.application.findMany({
      where: { companyId },
      select: { position: true },
    })
    const norm = (s: string) => s.trim().toLowerCase()
    const dup = siblings.some((a) => norm(a.position) === norm(position))
    if (dup) {
      appsSkipped++
      continue
    }

    const appliedAt = raw.appliedAt ? new Date(raw.appliedAt) : new Date()
    try {
      await db.application.create({
        data: {
          companyId,
          position,
          status: raw.status ?? "已投递",
          channel: raw.channel ?? null,
          notes: raw.notes ?? null,
          deadline: raw.deadline ? new Date(raw.deadline) : null,
          history: typeof raw.history === "string" ? raw.history : JSON.stringify([]),
          appliedAt: Number.isNaN(appliedAt.getTime()) ? new Date() : appliedAt,
        },
      })
      appsAdded++
    } catch {
      appsSkipped++
    }
  }

  const parts: string[] = []
  parts.push(`企业：新建 ${companiesAdded} 家、已存在跳过 ${companiesSkipped} 家`)
  parts.push(`投递记录：补入 ${appsAdded} 条、已存在跳过 ${appsSkipped} 条`)

  return NextResponse.json({
    companiesAdded,
    companiesSkipped,
    appsAdded,
    appsSkipped,
    message: `恢复完成 — ${parts.join("；")}`,
  })
}
