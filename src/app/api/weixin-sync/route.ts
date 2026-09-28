import { NextResponse } from "next/server"
import { getWeixinSyncJob, runWeixinSyncJob } from "@/lib/sogou-weixin"

export const dynamic = "force-dynamic"

// POST /api/weixin-sync — 受理一轮微信公众号直搜（搜狗微信），立即返回 202。
// 抓取（5 组关键词串行 + 组间随机间隔）+ LLM 提炼是长耗时操作（30~90s），
// 绝不在本请求内同步执行（502 教训）：后台任务执行，进度与结果通过
// GET /api/sync-status 的 weixinJob 字段轮询获取，报告另落库 lastWeixinReport。
export async function POST(req: Request) {
  const source = req.headers.get("x-fanlai-source") === "auto" ? "auto" : "manual"

  const alreadyRunning = getWeixinSyncJob().running
  const { started } = alreadyRunning ? { started: false } : runWeixinSyncJob(source)
  const job = getWeixinSyncJob()

  return NextResponse.json(
    {
      started,
      alreadyRunning,
      job: { running: job.running, source: job.source, startedAt: job.startedAt },
    },
    { status: 202 }
  )
}
