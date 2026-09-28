import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { shanghaiToday, parseDateStr, shiftDateStr } from "@/lib/date"
import type { QueryReportLike } from "@/lib/sync-types"
import { getWeixinSyncJob, type WeixinLastReport } from "@/lib/sogou-weixin"
import { getSyncJob } from "@/lib/sync-job"

export const dynamic = "force-dynamic"

const SEASONS = ["秋招", "春招", "社招"] as const

/** 数据源与更新机制说明（随接口返回，前端「数据源与更新」面板直接渲染） */
const PIPELINE = [
  {
    step: "1 · 多路检索",
    detail: "每天对 7 组关键词（覆盖官网公告、公众号推文、宣讲会、网申入口）执行联网检索，近 3-5 天动态优先",
  },
  {
    step: "2 · AI 提炼",
    detail: "检索结果交由 AI 提炼企业名 / 行业 / 简介 / 热招方向 / 来源，旧闻与往届信息按铁律剔除",
  },
  {
    step: "3 · 人工核实",
    detail: "AI 条目以「待核」琥珀标进入当日批次，点开详情一键「确认收录」转正式已核目录，或忽略",
  },
  {
    step: "4 · 手动兜底",
    detail: "发现遗漏时用「补充企业」即时录入，填写后立即进入已核目录，不必等下一轮抓取",
  },
] as const

const LIMITATIONS = [
  "自动抓取覆盖公开网络检索能触达的渠道（官网 / 公众号文章索引 / 招聘平台与高校就业网转发）；仅在小范围社群、内推群或未公开渠道放出的信息可能漏掉",
  "每轮 7 组关键词均自动重试（失败退避 2.5s / 6s 再试），仍失败的查询会在报告中如实标注，可点「再同步一轮」补抓",
  "AI 提炼遵循「宁可漏掉不可拿旧闻充数」：往届（非目标届别）与超过 14 天的旧公告会被守卫规则直接丢弃",
  "微信公众号直搜走搜狗微信收录的文章索引（每天 8/14/20 点自动 + 可手动抓取）；搜狗偶发反爬限流时当轮部分关键词会失败，原因在面板如实标注，下个时段自动补上",
] as const

// GET /api/sync-status?season= — 更新机制、最近一次同步执行报告、名录覆盖统计
export async function GET(req: Request) {
  const url = new URL(req.url)
  const seasonRaw = url.searchParams.get("season")?.trim() ?? ""
  const season = (SEASONS as readonly string[]).includes(seasonRaw) ? seasonRaw : "秋招"

  const today = shanghaiToday()
  const dayStart = parseDateStr(today)

  const [total, verifiedCount, pendingCount, hiddenCount, todayCount, logRow, reportRow, wxRow] =
    await Promise.all([
      db.company.count({ where: { season, hidden: false } }),
      db.company.count({ where: { season, hidden: false, verified: true } }),
      db.company.count({ where: { season, hidden: false, verified: false } }),
      db.company.count({ where: { season, hidden: true } }),
      db.company.count({ where: { season, hidden: false, publishedAt: { gte: dayStart } } }),
      db.setting.findUnique({ where: { key: "lastSyncLog" } }),
      db.setting.findUnique({ where: { key: "lastSyncReport" } }),
      db.setting.findUnique({ where: { key: "lastWeixinReport" } }),
    ])

  // 近 7 天每日批次放出家数（与名录口径一致：按 publishedAt 分日）
  const recentBatches: { date: string; count: number }[] = []
  try {
    const weekAgo = parseDateStr(shiftDateStr(today, -6))
    const rows = await db.company.groupBy({
      by: ["publishedAt"],
      where: {
        season,
        hidden: false,
        publishedAt: { gte: weekAgo, lt: new Date(dayStart.getTime() + 86400000) },
      },
      _count: { _all: true },
    })
    for (let i = 0; i < 7; i++) {
      const date = shiftDateStr(today, -6 + i)
      const hit = rows.find((r) => r.publishedAt.toISOString().slice(0, 10) === date)
      recentBatches.push({ date, count: hit?._count._all ?? 0 })
    }
  } catch {
    // 统计失败不阻塞面板
  }

  let lastSync: Record<string, unknown> | null = null
  if (logRow?.value) {
    try {
      lastSync = JSON.parse(logRow.value) as Record<string, unknown>
    } catch {}
  }

  let lastReport: Record<string, unknown> | null = null
  if (reportRow?.value) {
    try {
      lastReport = JSON.parse(reportRow.value) as Record<string, unknown>
    } catch {}
  }

  const queries = (lastReport?.queries as QueryReportLike[] | undefined) ?? null

  // 微信公众号直搜：后台任务状态 + 最近一轮报告（落库 lastWeixinReport，重启不丢）
  let weixinLast: WeixinLastReport | null = null
  if (wxRow?.value) {
    try {
      weixinLast = JSON.parse(wxRow.value) as WeixinLastReport
    } catch {}
  }

  return NextResponse.json({
    today,
    season,
    // 当前同步任务状态（202 受理后前端每 2s 轮询此字段取结果）
    job: getSyncJob(),
    // 微信直搜任务状态（POST /api/weixin-sync 受理后同样轮询 weixinJob）
    weixinJob: getWeixinSyncJob(),
    weixinLast,
    schedule: {
      pushHour: 8,
      checkEveryMinutes: 10,
      timezone: "Asia/Shanghai",
      text: "每天 08:00（上海时间）后自动同步一次；若失败，每 10 分钟自动补跑直至成功",
    },
    pipeline: PIPELINE,
    limitations: LIMITATIONS,
    coverage: {
      total,
      verifiedCount,
      pendingCount,
      hiddenCount,
      todayCount,
      recentBatches,
    },
    lastSync,
    lastReport: lastReport
      ? {
          at: lastReport.at,
          season: lastReport.season,
          source: lastReport.source,
          searched: lastReport.searched,
          added: lastReport.added,
          refreshed: lastReport.refreshed,
          llm: lastReport.llm,
          queries,
          okCount: queries ? queries.filter((q) => q.ok).length : null,
          failCount: queries ? queries.filter((q) => !q.ok).length : null,
        }
      : null,
  })
}
