import { NextResponse } from "next/server"
import { getLastAuditReport, getAuditJob, startAuditJob } from "@/lib/audit-job"

export const dynamic = "force-dynamic"
export const maxDuration = 300

// POST /api/audit { season? } — 受理一轮「查漏体检」，立即返回 202。
// 体检与同步一样是长耗时操作（10 组检索 + LLM 提炼），走同一套异步任务模式。
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const seasonRaw = typeof body?.season === "string" ? body.season : "秋招"
  const season = (["秋招", "春招", "社招"] as string[]).includes(seasonRaw) ? seasonRaw : "秋招"

  const alreadyRunning = getAuditJob().running
  const { started } = alreadyRunning ? { started: false } : startAuditJob(season)
  const job = getAuditJob()

  return NextResponse.json(
    {
      started,
      alreadyRunning,
      job: { running: job.running, season: job.season, startedAt: job.startedAt },
    },
    { status: 202 }
  )
}

// GET /api/audit — 当前体检任务状态 + 上次体检报告（含疑似遗漏候选清单）
export async function GET() {
  const job = getAuditJob()
  const lastReport = await getLastAuditReport()
  return NextResponse.json({ job, lastReport })
}
