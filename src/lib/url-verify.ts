/**
 * 企业官网（recruitUrl）可达性核验 · 可复用模块（Task 27-a 创建）
 *
 * 逻辑源自 scripts/verify-urls.ts（Task 26-a 的一次性核对脚本），抽成模块后供三处复用：
 *   ① POST /api/verify 手动触发一轮（默认 limit 24，body 可带 full/limit）
 *   ② 调度器每日主同步成功后自动跑一轮（limit 30，当日去重）
 *   ③ tsx 临时脚本全量核验（full: true）
 *
 * ⚠️ DB 层用 $queryRaw / $executeRaw 而非 typed 模型 API：
 *   运行中的 dev server 进程里 @prisma/client 是启动时刻的旧实例（DMMF 不含新列），
 *   typed 查询遇到 urlStatus / urlCheckedAt 会报 Unknown argument；raw SQL 绕开模型校验，
 *   对 SQLite 真实列直接读写（DateTime 列 = epoch 毫秒整数，与 Prisma SQLite 存储格式一致），
 *   新旧进程 / 重启后行为完全一致。
 *
 * 核验语义（对齐 verify-urls.ts，收敛为三档落库）：
 *   ok   = 2xx 且最终主域未变（招聘页可达）
 *   soft = 反爬状态码（403/429/503 等，域名活着）或 2xx 跨主域跳转（可达但可能已非原招聘页）
 *   fail = DNS 失败 / 连接被拒 / 超时 / 4xx / 5xx（复核一轮仍 fail 才定论）
 * fail 的企业自动尝试 repair：候选域名变体（加/去 www、careers./campus./job./hr./join. 前缀、
 * http→https），变体 2xx 且主域一致才采纳 —— 改写 recruitUrl 并标 ok（严格原则同 26-a）。
 *
 * 限流：并发 2、每目标间隔 350ms、超时 8s（repair 探测 5s）、正常浏览器 UA。
 * 所有网络请求 / DB 写入均 try/catch 不外逸；fail 也写 urlCheckedAt（避免反复重试同一家）。
 * 互斥：模块级 running 标志（挂 globalThis 防 dev HMR 丢状态），同时只允许一轮。
 */

import { Prisma } from "@prisma/client"
import { db } from "./db"
import { domainFromUrl } from "./logo"

const TIMEOUT_MS = 8000
const REPAIR_TIMEOUT_MS = 5000
const CONCURRENCY = 2
const GAP_MS = 350
const CONFIRM_GAP_MS = 2000 // FAIL 复核轮前的间隔
const MAX_REPAIR_CANDIDATES = 8 // 单企业 repair 探测上限（防超长阻塞）
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"

const HEADERS = {
  "User-Agent": UA,
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

/** 反爬但域名活着的状态码：浏览器通常可访问，不算死链（412=WAF 前置校验，999=腾讯系自定义） */
const SOFT_STATUSES = new Set([401, 403, 405, 406, 412, 418, 429, 503, 999])

export type UrlStatus = "ok" | "soft" | "fail"

export interface VerifyDetail {
  name: string
  url: string // 核验时的原 recruitUrl
  status: UrlStatus // 最终落库状态
  note: string // 失败原因 / 跳转说明 / 修复说明
  repairedUrl?: string // repair 成功时改写后的新 recruitUrl
}

export interface VerifyRoundResult {
  checked: number // 本轮核验企业数（按家计，含共用同 URL 的重复家数）
  repaired: number // 其中通过域名变体自动改写 recruitUrl 修复的家数
  ok: number
  soft: number
  fail: number
  skipped: boolean // true = 已有核验轮在跑，本轮直接让路
  details: VerifyDetail[]
}

export interface VerifyStats {
  total: number
  ok: number
  soft: number
  fail: number
  unchecked: number
  lastCheckedAt: string | null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 互斥标志挂 globalThis：dev 模式模块重载 / 多路由引用共享同一份运行状态 */
const g = globalThis as unknown as { __fanlaiVerifyRunning?: boolean }

export function isVerifyRoundRunning(): boolean {
  return !!g.__fanlaiVerifyRunning
}

interface ProbeResult {
  url: string
  status: number | null // 最终状态码（网络异常为 null）
  finalUrl: string | null // 重定向后的最终 URL
  category: UrlStatus
  ms: number
  note: string
}

/** 按状态码 + 跨域跳转定分类（三档收敛：跨主域 2xx 归 soft —— 可达但可能已非原招聘页） */
function classify(rawUrl: string, status: number | null, finalUrl: string | null): { category: UrlStatus; crossApex: boolean } {
  const apexA = domainFromUrl(rawUrl)
  const apexB = finalUrl ? domainFromUrl(finalUrl) : null
  const crossApex = !!apexA && !!apexB && apexA !== apexB
  let category: UrlStatus
  if (status !== null && status >= 200 && status < 300 && !crossApex) category = "ok"
  else if (status !== null && ((status >= 200 && status < 300) || SOFT_STATUSES.has(status))) category = "soft"
  else category = "fail"
  return { category, crossApex }
}

/** 单次探测：GET + redirect follow + 8s 超时；TLS 证书异常时降级试 http 同主机（浏览器可忽略告警继续访问 → 视作域名活着 soft） */
async function probe(rawUrl: string, timeoutMs = TIMEOUT_MS): Promise<ProbeResult> {
  const t0 = Date.now()
  try {
    const res = await fetch(rawUrl, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: HEADERS })
    await res.arrayBuffer().catch(() => {}) // 排空 body 释放 socket
    const ms = Date.now() - t0
    const finalUrl = res.url || rawUrl
    const { category, crossApex } = classify(rawUrl, res.status, finalUrl)
    const note = crossApex ? `跳转至 ${finalUrl}` : `HTTP ${res.status}`
    return { url: rawUrl, status: res.status, finalUrl, category, ms, note }
  } catch (e) {
    const err = e as Error
    const ms = Date.now() - t0
    const msg = `${err.name}: ${err.message}`
    if (/cert|tls|ssl|certificate/i.test(msg)) {
      // HTTPS 证书异常 → 降级试 http:// 同主机
      try {
        const httpUrl = rawUrl.replace(/^https:\/\//i, "http://")
        const res2 = await fetch(httpUrl, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: HEADERS })
        await res2.arrayBuffer().catch(() => {})
        const ms2 = Date.now() - t0
        if (res2.status >= 200 && res2.status < 300) {
          return { url: rawUrl, status: res2.status, finalUrl: res2.url || httpUrl, category: "soft", ms: ms2, note: "HTTPS 证书异常，http 可达" }
        }
        return { url: rawUrl, status: res2.status, finalUrl: res2.url || httpUrl, category: "fail", ms: ms2, note: `HTTPS 证书异常，http 返回 ${res2.status}` }
      } catch (e2) {
        return { url: rawUrl, status: null, finalUrl: null, category: "fail", ms, note: `TLS 证书异常且 http 亦不可达：${(e2 as Error).message.slice(0, 80)}` }
      }
    }
    const code = (err as Error & { code?: string }).code
    const kind =
      err.name === "TimeoutError" || err.name === "AbortError"
        ? `超时(${Math.round(timeoutMs / 1000)}s)`
        : /getaddrinfo|dns|ENOTFOUND|ENODATA/i.test(err.message)
          ? "DNS 解析失败"
          : code === "ConnectionRefused"
            ? "连接被拒(ConnectionRefused)"
            : code === "TooManyRedirects"
              ? "重定向循环(TooManyRedirects)"
              : code
                ? `${err.name}/${code}`
                : err.name
    return { url: rawUrl, status: null, finalUrl: null, category: "fail", ms, note: kind }
  }
}

/** 生成 repair 候选：http→https、去/加 www、careers./campus./job./hr./join. 前缀（跳过与原 host 相同者） */
export function repairCandidates(url: string): string[] {
  const apex = domainFromUrl(url)
  if (!apex) return []
  let host = ""
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return []
  }
  const bare = host.replace(/^www\./, "")
  const cands: string[] = []
  const push = (u: string) => {
    if (!cands.includes(u)) cands.push(u)
  }
  if (/^http:\/\//i.test(url)) push(url.replace(/^http:\/\//i, "https://")) // http→https 同路径
  if (bare !== apex) push(`https://${apex}`) // 去 www
  push(`https://www.${apex}`) // 加 www
  for (const sub of ["careers", "campus", "job", "hr", "join"]) {
    if (bare !== sub) push(`https://${sub}.${apex}`)
  }
  return cands.slice(0, MAX_REPAIR_CANDIDATES)
}

/** 对 FAIL 的 URL 做替代候选探测，返回首个 2xx 且主域一致的候选（严格原则：soft 不采纳） */
async function findRepair(url: string): Promise<{ url: string; status: number } | null> {
  for (const c of repairCandidates(url)) {
    try {
      const r = await probe(c, REPAIR_TIMEOUT_MS)
      console.log(`    [repair] ${r.category.padEnd(4)} ${String(r.status ?? "-").padEnd(4)} ${r.ms}ms ${c}`)
      if (r.category === "ok") return { url: c, status: r.status as number }
    } catch {
      // 单候选探测异常 → 尝试下一候选
    }
    await sleep(GAP_MS)
  }
  return null
}

interface Target {
  url: string
  ids: string[]
  names: string[]
}

/** 单目标（唯一 URL，可能挂多家企业）完整流水：探测 → FAIL 复核 → repair 尝试 */
async function processTarget(target: Target): Promise<{ status: UrlStatus; note: string; repairedUrl?: string }> {
  let r = await probe(target.url)
  if (r.category === "fail") {
    // 复核轮：排除瞬时网络抖动的误判
    await sleep(CONFIRM_GAP_MS)
    const r2 = await probe(target.url)
    if (r2.category !== "fail") {
      console.log(`[url-verify] 复核翻转（瞬态误判）${target.url} → ${r2.category} ${r2.status}`)
      r = r2
    } else {
      r = { ...r2, note: `${r.note}；复核轮仍 FAIL` }
    }
  }
  let status: UrlStatus = r.category
  let note = r.note
  let repairedUrl: string | undefined
  if (r.category === "fail") {
    console.log(`[url-verify] FAIL ${target.url}（${target.names.join("/")}）→ 尝试域名变体修复`)
    const cand = await findRepair(target.url)
    if (cand) {
      status = "ok"
      repairedUrl = cand.url
      note = `原链不可达（${r.note}），已自动修复 → ${cand.url}`
      console.log(`[url-verify] ✓ repair 成功：${target.url} → ${cand.url}（${target.names.join("/")}）`)
    }
  }
  return { status, note, repairedUrl }
}

/** 落库（raw SQL）：urlStatus + urlCheckedAt（epoch 毫秒，同 Prisma SQLite 存储格式），repair 时一并改写 recruitUrl */
async function persistResult(t: Target, status: UrlStatus, repairedUrl?: string): Promise<void> {
  const sets = [Prisma.sql`"urlStatus" = ${status}`, Prisma.sql`"urlCheckedAt" = ${Date.now()}`]
  if (repairedUrl) sets.push(Prisma.sql`"recruitUrl" = ${repairedUrl}`)
  await db.$executeRaw`UPDATE Company SET ${Prisma.join(sets, ", ")} WHERE "id" IN (${Prisma.join(t.ids)})`
}

/**
 * 跑一轮核验。
 * - 默认增量：选取 urlCheckedAt 为 null 的优先、其次最旧的 limit 家（默认 24）
 * - full: true（或 limit: 0）全量
 * 结果逐家写回 Company.urlStatus / urlCheckedAt（fail 也写，避免反复重试同一家）；
 * repair 成功时一并改写 recruitUrl。共用同一 URL 的多家企业一次探测、批量写回。
 */
export async function runVerifyRound(opts?: { limit?: number; full?: boolean }): Promise<VerifyRoundResult> {
  const empty: VerifyRoundResult = { checked: 0, repaired: 0, ok: 0, soft: 0, fail: 0, skipped: true, details: [] }
  if (g.__fanlaiVerifyRunning) {
    console.log("[url-verify] 已有核验轮在跑，本轮跳过（互斥让路）")
    return empty
  }
  g.__fanlaiVerifyRunning = true
  const t0 = Date.now()
  try {
    const limit = opts?.full ? 0 : opts?.limit ?? 24
    let rows: { id: string; name: string; recruitUrl: string; urlCheckedAt: number | null }[] = []
    try {
      const raw = await db.$queryRaw<{ id: string; name: string; recruitUrl: string; urlCheckedAt: number | null }[]>`SELECT id, name, "recruitUrl", "urlCheckedAt" FROM Company`
      // $queryRaw 对 SQLite INTEGER 列返回 BigInt（含新列 urlCheckedAt），统一收敛为 Number（epoch 毫秒在安全整数范围内）
      rows = raw.map((r) => ({ ...r, urlCheckedAt: r.urlCheckedAt == null ? null : Number(r.urlCheckedAt) }))
    } catch (e) {
      console.warn(`[url-verify] 读取企业名录失败：${(e as Error).message.slice(0, 160)}`)
      return empty
    }

    // 增量选取：null 优先 → 最旧优先；full / limit=0 全量
    let picked = rows
    if (!opts?.full && limit > 0) {
      picked = [...rows]
        .sort((a, b) => {
          if (!a.urlCheckedAt && !b.urlCheckedAt) return 0
          if (!a.urlCheckedAt) return -1
          if (!b.urlCheckedAt) return 1
          return a.urlCheckedAt - b.urlCheckedAt
        })
        .slice(0, limit)
    }
    if (picked.length === 0) return { ...empty, skipped: false }

    // 按 URL 去重（多家企业可能共用同一招聘页），一次探测、批量写回
    const targetMap = new Map<string, Target>()
    for (const row of picked) {
      const t = targetMap.get(row.recruitUrl) ?? { url: row.recruitUrl, ids: [], names: [] }
      t.ids.push(row.id)
      t.names.push(row.name)
      targetMap.set(row.recruitUrl, t)
    }
    const targets = [...targetMap.values()]
    const mode = opts?.full || limit <= 0 ? "全量" : "增量"
    console.log(`[url-verify] ${mode}核验开始：企业 ${picked.length} 家 → 唯一 URL ${targets.length} 条 · 并发 ${CONCURRENCY} · 间隔 ${GAP_MS}ms · 超时 ${TIMEOUT_MS}ms`)

    const details: VerifyDetail[] = []
    const stat = { ok: 0, soft: 0, fail: 0, repaired: 0 }
    let cursor = 0

    async function worker(id: number) {
      while (cursor < targets.length) {
        const idx = cursor++
        const t = targets[idx]
        try {
          const out = await processTarget(t)
          // 落库（fail 也写 urlCheckedAt；repair 成功一并改写 recruitUrl）
          try {
            await persistResult(t, out.status, out.repairedUrl)
          } catch (e) {
            console.warn(`[url-verify] 写回失败（${t.names.join("/")}）：${(e as Error).message.slice(0, 120)}`)
          }
          stat[out.status]++
          if (out.repairedUrl) stat.repaired += t.ids.length
          for (const name of t.names) {
            details.push({ name, url: t.url, status: out.status, note: out.note, ...(out.repairedUrl ? { repairedUrl: out.repairedUrl } : {}) })
          }
          console.log(`[url-verify] w${id} ${out.status.padEnd(4)} ${t.url}${t.names.length > 1 ? `（${t.names.length} 家共用）` : ""} ← ${out.note}`)
        } catch (e) {
          // 单目标整链路兜底：绝不让异常打断整轮
          console.warn(`[url-verify] w${id} 目标异常跳过 ${t.url}：${(e as Error).message.slice(0, 120)}`)
          stat.fail += t.ids.length
          for (const name of t.names) details.push({ name, url: t.url, status: "fail", note: `核验流程异常：${(e as Error).message.slice(0, 80)}` })
        }
        await sleep(GAP_MS)
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)))

    console.log(`[url-verify] ${mode}核验完成（${((Date.now() - t0) / 1000).toFixed(1)}s）：checked=${picked.length} ok=${stat.ok} soft=${stat.soft} fail=${stat.fail} repaired=${stat.repaired}`)
    return { checked: picked.length, repaired: stat.repaired, ok: stat.ok, soft: stat.soft, fail: stat.fail, skipped: false, details }
  } finally {
    g.__fanlaiVerifyRunning = false
  }
}

/** 官网核验统计（聚合查询）：total / ok / soft / fail / unchecked / lastCheckedAt */
export async function verifyStats(): Promise<VerifyStats> {
  const groups = await db.$queryRaw<{ urlStatus: string | null; n: number }[]>`SELECT "urlStatus", COUNT(*) AS n FROM Company GROUP BY "urlStatus"`
  const lastRows = await db.$queryRaw<{ m: number | null }[]>`SELECT MAX("urlCheckedAt") AS m FROM Company`
  // SQLite INTEGER 列经 $queryRaw 返回 BigInt，统一收敛为 Number
  const countOf = (s: string | null) => Number(groups.find((row) => row.urlStatus === s)?.n ?? 0)
  const lastMs = lastRows[0]?.m != null ? Number(lastRows[0].m) : 0
  return {
    total: groups.reduce((n, row) => n + Number(row.n), 0),
    ok: countOf("ok"),
    soft: countOf("soft"),
    fail: countOf("fail"),
    unchecked: countOf(null),
    lastCheckedAt: lastMs > 0 ? new Date(lastMs).toISOString() : null,
  }
}
