import { NextResponse } from "next/server"
import { getSyncJob, startSyncJob } from "@/lib/sync-job"

export const dynamic = "force-dynamic"
export const maxDuration = 300

// POST /api/refresh { season? } — 受理一轮情报同步，立即返回 202。
// 检索 + LLM 提炼是长耗时操作（30~90s），原先在本请求内同步执行，网关会因超时 502 断开，
// 用户端表现为「同步失败」。现在改为后台任务执行，进度与结果通过 GET /api/sync-status 轮询获取。
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const seasonRaw = typeof body?.season === "string" ? body.season : "秋招"
  const season = (["秋招", "春招", "社招"] as string[]).includes(seasonRaw) ? seasonRaw : "秋招"
  const source = req.headers.get("x-fanlai-source") === "auto" ? "auto" : "manual"

  const alreadyRunning = getSyncJob().running
  const { started } = alreadyRunning ? { started: false } : startSyncJob(season, source)
  const job = getSyncJob()

  return NextResponse.json(
    {
      started,
      alreadyRunning,
      job: { running: job.running, season: job.season, startedAt: job.startedAt, source: job.source },
    },
    { status: 202 }
  )
}
