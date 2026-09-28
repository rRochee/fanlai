/**
 * 饭来 · 种子数据脚本
 * 用法: bun run prisma/seed.ts
 * 幂等：按企业名 upsert，可重复执行用于「每日批次刷新」
 */
import { PrismaClient } from "@prisma/client"
import { CATALOG } from "../src/lib/catalog"

const prisma = new PrismaClient()

/** 获取上海时区的今天 YYYY-MM-DD */
function shanghaiToday(): string {
  const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" })
  return fmt.format(new Date()) // sv-SE locale gives YYYY-MM-DD
}

/** 将日期字符串偏移 N 天后返回 UTC 午夜的 Date */
function dateWithOffset(base: string, offsetDays: number): Date {
  const d = new Date(`${base}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d
}

async function main() {
  const today = shanghaiToday()
  console.log(`Seeding companies with today = ${today} (Asia/Shanghai)`)

  let created = 0
  let updated = 0

  for (const c of CATALOG) {
    const publishedAt = dateWithOffset(today, c.batchOffset)
    // 网申截止：catalog 里给 YYYY-MM-DD；未给的不覆盖（保留人工/同步写入的值）
    const deadline =
      c.deadline && /^\d{4}-\d{2}-\d{2}$/.test(c.deadline)
        ? new Date(`${c.deadline}T00:00:00Z`)
        : undefined
    const data = {
      name: c.name,
      fullName: c.fullName ?? null,
      industry: c.industry,
      city: c.city,
      size: c.size,
      funding: c.funding,
      summary: c.summary,
      description: c.description,
      positions: c.positions.join(","),
      tags: c.tags.join(","),
      recruitUrl: c.recruitUrl,
      sourceType: c.sourceType,
      sourceName: c.sourceName,
      publishedAt,
      ...(deadline ? { deadline } : {}),
      verified: true,
    }
    const result = await prisma.company.upsert({
      where: { name: c.name },
      create: data,
      update: data,
    })
    // upsert result doesn't tell created vs updated; count via createdAt check
    if (Math.abs(result.createdAt.getTime() - Date.now()) < 5000) created++
    else updated++
  }

  const total = await prisma.company.count()
  console.log(`Done. created≈${created}, updated≈${updated}, total=${total}`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
