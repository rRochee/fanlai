// 饭来 · 每日情报调度器
// 随 Next.js 服务端启动（src/instrumentation.ts register 钩子）：
// ① 主同步：上海时间已过 08:00 且今日尚未同步，触发一轮情报同步（成功后才记录 lastRefreshDate）。
// ② 微信直搜：每天 08:00 / 14:00 / 20:00 各触发一轮搜狗微信直搜（时段标记持久化，dev 重启不重复轰）。
// 两条管道均走后台任务（不再 HTTP 自调用，避免网关超时 502），
// 调度器轮询任务状态仅为日志观察；失败不抛出——主同步下个周期会重试，微信直搜下个时段自然补跑。

import { getSyncJob, isSyncRunning, startSyncJob } from "@/lib/sync-job"
import { getWeixinSyncJob, isWeixinSyncRunning, runWeixinSyncJob } from "@/lib/sogou-weixin"

let started = false

const CHECK_INTERVAL = 10 * 60 * 1000 // 每 10 分钟检查一次
const PUSH_HOUR = 8 // 每日 08:00（上海时间）后触发
const SETTING_KEY = "lastRefreshDate"
const JOB_POLL_INTERVAL = 3_000
const JOB_POLL_MAX = 100 // 3s × 100 = 最长等 5 分钟
const WEIXIN_HOURS = [8, 14, 20] // 微信直搜每日触发点（上海时间）
const WEIXIN_SLOT_KEY = "lastWeixinRunSlot"

function shanghaiNowParts() {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
  const [date, time] = fmt.format(new Date()).split(" ")
  return { date, hour: parseInt(time.slice(0, 2), 10) }
}

async function getLastRunDate(): Promise<string | null> {
  try {
    const { db } = await import("@/lib/db")
    const row = await db.setting.findUnique({ where: { key: SETTING_KEY } })
    return row?.value ?? null
  } catch {
    return null
  }
}

async function setLastRunDate(date: string) {
  try {
    const { db } = await import("@/lib/db")
    await db.setting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: date },
      update: { value: date },
    })
  } catch {
    // ignore
  }
}

/** 当前时刻对应的微信直搜时段标记（如 "2026-09-02-14"）；未到 8 点返回 null */
function weixinSlotFor(date: string, hour: number): string | null {
  if (hour >= WEIXIN_HOURS[2]) return `${date}-${WEIXIN_HOURS[2]}`
  if (hour >= WEIXIN_HOURS[1]) return `${date}-${WEIXIN_HOURS[1]}`
  if (hour >= WEIXIN_HOURS[0]) return `${date}-${WEIXIN_HOURS[0]}`
  return null
}

async function getWeixinSlotDone(): Promise<string | null> {
  try {
    const { db } = await import("@/lib/db")
    const row = await db.setting.findUnique({ where: { key: WEIXIN_SLOT_KEY } })
    return row?.value ?? null
  } catch {
    return null
  }
}

async function setWeixinSlotDone(slot: string) {
  try {
    const { db } = await import("@/lib/db")
    await db.setting.upsert({
      where: { key: WEIXIN_SLOT_KEY },
      create: { key: WEIXIN_SLOT_KEY, value: slot },
      update: { value: slot },
    })
  } catch {
    // ignore
  }
}

/** 微信直搜时段检查：先持久化「本时段已触发」再启动任务——dev 重启 / 重复检查都不会对同一时段重复轰 */
async function checkAndRunWeixin() {
  const { date, hour } = shanghaiNowParts()
  const slot = weixinSlotFor(date, hour)
  if (!slot) return
  if ((await getWeixinSlotDone()) === slot) return

  await setWeixinSlotDone(slot)
  const startedAt = Date.now()
  const { started } = runWeixinSyncJob("auto")
  if (!started) {
    console.log(`[fanlai-scheduler] ${slot} 微信直搜已有任务在跑，本时段不再重复触发`)
    return
  }

  // 轮询只为日志观察（结果已落库 lastWeixinReport，前端面板可见；失败留给下个时段补跑）
  for (let i = 0; i < JOB_POLL_MAX; i++) {
    await sleep(JOB_POLL_INTERVAL)
    const job = getWeixinSyncJob()
    if (job.running) continue
    if (job.error) {
      console.log(`[fanlai-scheduler] ${slot} 微信直搜失败：${job.error.slice(0, 120)}`)
      return
    }
    const r = job.result
    if (r) {
      console.log(
        `[fanlai-scheduler] ${slot} 微信直搜完成（${Math.round((Date.now() - startedAt) / 1000)}s）：articles=${r.articlesFound} added=${r.candidatesAdded} errors=${r.errors.length}`
      )
    }
    return
  }
  console.log(`[fanlai-scheduler] ${slot} 微信直搜超 ${Math.round((Date.now() - startedAt) / 1000)}s 未完成，不再等待（任务仍在后台跑）`)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function checkAndPush() {
  const { date, hour } = shanghaiNowParts()
  if (hour < PUSH_HOUR) return

  const last = await getLastRunDate()
  if (last === date) return

  // 今日尚未同步且已过推送时间：直接启动后台同步任务（同进程调用，不经 HTTP/网关）
  const startedAt = Date.now()
  const { started } = startSyncJob("秋招", "auto")
  if (!started) {
    console.log(`[fanlai-scheduler] ${date} 已有同步任务在跑，等待其完成后标记`)
  }

  // 轮询任务状态直至完成（成功才写 lastRefreshDate，失败留给下个周期重试）
  for (let i = 0; i < JOB_POLL_MAX; i++) {
    await sleep(JOB_POLL_INTERVAL)
    const job = getSyncJob()
    if (job.running) continue
    if (job.error) {
      console.log(`[fanlai-scheduler] ${date} 推送失败：${job.error.slice(0, 120)}，下个周期重试`)
      return
    }
    const r = job.result
    if (r) {
      await setLastRunDate(date)
      console.log(
        `[fanlai-scheduler] ${date} 每日情报推送完成（${Math.round((Date.now() - startedAt) / 1000)}s）：added=${r.added} refreshed=${r.refreshed} ${r.message}`
      )
    }
    return
  }
  console.log(`[fanlai-scheduler] ${date} 同步超 ${Math.round((Date.now() - startedAt) / 1000)}s 未完成，不再等待（任务仍在后台跑，下轮检查再确认）`)
}

export function startScheduler() {
  if (started) return
  started = true
  // 本地开发可设 FANLAI_DISABLE_AUTO=1 关闭自动同步（缺 .z-ai-config 时
  // AI 情报管道必然失败，避免每 10 分钟刷一遍「推送失败」日志）
  if (process.env.FANLAI_DISABLE_AUTO === "1") {
    console.log("[fanlai-scheduler] FANLAI_DISABLE_AUTO=1，自动同步/推送已关闭（可在页面手动同步）")
    return
  }
  // 启动后延迟 20s 首检（等服务就绪），随后按固定间隔检查两条管道
  setTimeout(() => {
    void checkAndPush()
    void checkAndRunWeixin()
    setInterval(() => {
      if (!isSyncRunning()) void checkAndPush()
      if (!isWeixinSyncRunning()) void checkAndRunWeixin()
    }, CHECK_INTERVAL)
  }, 20_000)
  console.log("[fanlai-scheduler] 每日情报调度器已启动（08:00 后主同步一次 + 每天 8/14/20 点微信直搜，10 分钟粒度补跑）")
}
