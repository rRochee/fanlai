/**
 * 集成测试（等价于 POST /api/refresh 的产品路径——调度器/受理端点同款 in-process 调用）：
 *   bun scripts/sync-integration-test.ts
 * 跑一轮完整同步（联网检索 → AI 提炼 → 入库 → 搜狗微信直搜补充管道），轮询 phase 直至完成，
 * 随后调用 /api/articles 与 /api/stats 的路由处理器验证响应。
 */
import { startSyncJob, getSyncJob } from "../src/lib/sync-job"
import { GET as articlesGET } from "../src/app/api/articles/route"
import { GET as statsGET } from "../src/app/api/stats/route"
import { NextRequest } from "next/server"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const { started } = startSyncJob("秋招", "manual")
  console.log(`sync accepted: started=${started}`)

  let lastPhase = ""
  for (let i = 0; i < 150; i++) {
    await sleep(2000)
    const job = getSyncJob()
    if (job.running && job.phase && job.phase !== lastPhase) {
      lastPhase = job.phase
      console.log(`[phase] ${job.phase} (${Math.round(job.elapsedMs / 1000)}s)`)
    }
    if (!job.running) {
      console.log(`sync finished in ${Math.round(job.elapsedMs / 1000)}s, error=${job.error ?? "null"}`)
      if (job.result) {
        console.log("result.added =", job.result.added)
        console.log("result.message =", job.result.message)
      }
      break
    }
  }

  // /api/articles 路由处理器直调（NextRequest 构造）
  const areq = new NextRequest("http://local/api/articles?limit=5")
  const ares = await articlesGET(areq)
  const adata = (await ares.json()) as { items: unknown[]; total: number; limit: number }
  console.log(`\n/api/articles → HTTP ${ares.status}, total=${adata.total}, limit=${adata.limit}, items=${adata.items.length}`)
  console.log("first item keys:", Object.keys((adata.items[0] ?? {}) as object).join(","))

  // /api/stats 路由处理器直调
  const sreq = new NextRequest("http://local/api/stats?season=秋招")
  const sres = await statsGET(sreq)
  const sdata = (await sres.json()) as Record<string, unknown>
  console.log(`/api/stats → HTTP ${sres.status}, articles=${sdata.articles}, total=${sdata.total}`)

  // 同步日志 weixin 字段
  const { db } = await import("../src/lib/db")
  const log = await db.setting.findUnique({ where: { key: "lastSyncLog" } })
  console.log("\nlastSyncLog =", log?.value.slice(0, 400))
  process.exit(0)
}

main()
