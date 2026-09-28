/// <reference types="bun-types" />
/**
 * 搜狗微信直搜管道 CLI（验证/运维两用）：
 *   bun scripts/source-harvest-cli.ts            # 跑一轮完整管道：抓取 → 匹配 → 入库
 *   bun scripts/source-harvest-cli.ts --parse    # 只对 /tmp/sogou-real.html 做解析回归（不联网）
 */
import { runSourceArticleHarvest } from "../src/lib/sources/matcher"
import { parseSogouResultHtml } from "../src/lib/sources/sogou-weixin"
import { db } from "../src/lib/db"

async function main() {
  if (process.argv.includes("--parse")) {
    const html = await Bun.file("/tmp/sogou-real.html").text()
    const arts = parseSogouResultHtml(html, "27届秋招")
    console.log(`解析条数: ${arts.length}`)
    for (const a of arts) {
      console.log(`- [${a.account}] ${a.title} | ${a.publishedAt?.toISOString() ?? "无时间"} | ${a.url.slice(0, 60)}…`)
      console.log(`  摘要: ${a.summary.slice(0, 60)}`)
    }
    process.exit(0)
  }

  const r = await runSourceArticleHarvest("manual")
  console.log(JSON.stringify(r, null, 2))

  const total = await db.sourceArticle.count()
  const matched = await db.sourceArticle.count({ where: { status: "matched" } })
  const recent = await db.sourceArticle.findMany({ orderBy: { fetchedAt: "desc" }, take: 6 })
  console.log(`\n库内 SourceArticle 总数=${total}，matched=${matched}`)
  for (const a of recent) {
    console.log(`- [${a.status}] ${a.title} → ${a.matchedNames ?? "-"}`)
  }
  process.exit(0)
}

main()
