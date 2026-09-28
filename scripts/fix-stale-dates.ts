// 一次性修复：AI 情报行的 publishedAt 必须等于实际入库日（情报送达日语义）
// 运行：bun scripts/fix-stale-dates.ts
import { PrismaClient } from "@prisma/client"

const db = new PrismaClient()

const ymd = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" })
const dayOf = (d: Date) => ymd.format(d)
const parseDay = (s: string) => new Date(`${s}T00:00:00Z`)

async function main() {
  const rows = await db.company.findMany({
    where: { sourceType: "情报抓取" },
    select: { id: true, name: true, publishedAt: true, createdAt: true },
  })
  let fixed = 0
  for (const r of rows) {
    const ingestDay = dayOf(r.createdAt)
    if (dayOf(r.publishedAt) !== ingestDay) {
      await db.company.update({ where: { id: r.id }, data: { publishedAt: parseDay(ingestDay) } })
      console.log(`fixed ${r.name}: ${dayOf(r.publishedAt)} -> ${ingestDay}`)
      fixed++
    }
  }
  console.log(`done. scanned=${rows.length} fixed=${fixed}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
