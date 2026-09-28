/**
 * 企业 recruitUrl 批量可达性核对脚本（Task 26-a 创建，bun 运行）
 *
 * 流程：读 src/lib/catalog.ts 全部企业 recruitUrl（按 URL 去重）→ 并发 3 worker 逐家
 *       GET（redirect follow / 9s 超时 / 浏览器 UA / Accept-Language zh-CN）→ 记录最终
 *       状态码、最终 URL、耗时 → 四分类：OK(2xx) / SOFT(403/405/406/429/503 等反爬但
 *       域名活着) / REDIRECT(最终主域≠原主域) / FAIL(DNS 失败/拒绝/超时/404/410/5xx)。
 *
 * 用法：
 *   bun scripts/verify-urls.ts                      # 全量核对（含 FAIL 复核轮）
 *   bun scripts/verify-urls.ts --only=url1,url2     # 只核对指定 URL（精确匹配 recruitUrl 原文，逗号分隔）
 *   bun scripts/verify-urls.ts --repair             # 核对后对 FAIL 域名做替代 URL 修复尝试
 *
 * 修复原则（严格）：仅当原 URL 两轮均 FAIL、且替代 URL 返回 OK(200~299) 时才输出
 * 修复建议（catalog.ts 的人工 Edit 由代理执行，本脚本只给出候选）；SOFT 一律不改。
 * 替代候选：https://www.{apex} → https://campus|join|talent|hr|job|zhaopin|careers.{apex}
 *           （http:// 开头的原 URL 额外尝试 https:// 同主机路径）。
 *
 * 礼貌抓取：每请求后 sleep 350ms；结果落盘 scripts/verify-urls-result.json 供后续步骤消费。
 */

import { writeFileSync } from "node:fs"

import { CATALOG } from "../src/lib/catalog"
import { domainFromUrl } from "../src/lib/logo"

const TIMEOUT_MS = 9000
const CONCURRENCY = 3
const GAP_MS = 350
const CONFIRM_GAP_MS = 2000 // FAIL 复核轮前的间隔
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"

/** 反爬但域名活着的状态码：浏览器通常可访问，不算死链（412=WAF 前置校验，999=腾讯系自定义） */
const SOFT_STATUSES = new Set([401, 403, 405, 406, 412, 418, 429, 503, 999])

type Category = "OK" | "SOFT" | "REDIRECT" | "FAIL"

interface ProbeResult {
  url: string
  status: number | null // 最终状态码（网络异常为 null）
  finalUrl: string | null // 重定向后的最终 URL
  crossApex: boolean // 最终 URL 主域 ≠ 原 URL 主域
  ms: number
  category: Category
  note: string // 错误原因 / 跳转说明 / TLS 降级说明
}

interface VerifyEntry extends ProbeResult {
  companies: string[] // 使用该 URL 的企业名（同 URL 多企业共用）
  repairs: { url: string; status: number; ms: number }[] // --repair 时的 OK 替代候选
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const HEADERS = {
  "User-Agent": UA,
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

/** 按状态码 + 跨域跳转定分类 */
function classify(rawUrl: string, status: number | null, finalUrl: string | null, note: string): { category: Category; crossApex: boolean } {
  const apexA = domainFromUrl(rawUrl)
  const apexB = finalUrl ? domainFromUrl(finalUrl) : null
  const crossApex = !!apexA && !!apexB && apexA !== apexB
  let category: Category
  if (status !== null && status >= 200 && status < 300 && crossApex) {
    category = "REDIRECT"
  } else if (status !== null && status >= 200 && status < 300) {
    category = "OK"
  } else if (status !== null && SOFT_STATUSES.has(status)) {
    category = "SOFT"
  } else {
    category = "FAIL"
  }
  return { category, crossApex }
}

/** 单次探测：GET + redirect follow + 9s 超时；TLS 证书异常时降级试 http 同主机（浏览器可忽略告警继续访问 → 视作域名活着 SOFT） */
async function probe(rawUrl: string): Promise<ProbeResult> {
  const t0 = Date.now()
  try {
    const res = await fetch(rawUrl, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS), headers: HEADERS })
    await res.arrayBuffer().catch(() => {}) // 排空 body 释放 socket
    const ms = Date.now() - t0
    const finalUrl = res.url || rawUrl
    const { category, crossApex } = classify(rawUrl, res.status, finalUrl, "")
    const note = crossApex ? `跳转至 ${finalUrl}` : ""
    return { url: rawUrl, status: res.status, finalUrl, crossApex, ms, category, note }
  } catch (e) {
    const err = e as Error
    const ms = Date.now() - t0
    const msg = `${err.name}: ${err.message}`
    if (/cert|tls|ssl|certificate/i.test(msg)) {
      // HTTPS 证书异常 → 降级试 http:// 同主机
      try {
        const httpUrl = rawUrl.replace(/^https:\/\//i, "http://")
        const res2 = await fetch(httpUrl, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS), headers: HEADERS })
        await res2.arrayBuffer().catch(() => {})
        const ms2 = Date.now() - t0
        if (res2.status >= 200 && res2.status < 300) {
          return { url: rawUrl, status: res2.status, finalUrl: res2.url || httpUrl, crossApex: false, ms: ms2, category: "SOFT", note: `HTTPS 证书异常（${msg.slice(0, 80)}），http 可达` }
        }
        return { url: rawUrl, status: res2.status, finalUrl: res2.url || httpUrl, crossApex: false, ms: ms2, category: "FAIL", note: `HTTPS 证书异常，http 返回 ${res2.status}` }
      } catch (e2) {
        return { url: rawUrl, status: null, finalUrl: null, crossApex: false, ms, category: "FAIL", note: `TLS 证书异常且 http 亦不可达：${(e2 as Error).message.slice(0, 80)}` }
      }
    }
    const code = (err as Error & { code?: string }).code
    const kind = err.name === "TimeoutError" ? "超时(9s)" : /getaddrinfo|dns|ENOTFOUND|ENODATA/i.test(err.message) ? "DNS 解析失败" : code === "ConnectionRefused" ? "连接被拒(ConnectionRefused)" : code === "TooManyRedirects" ? "重定向循环(TooManyRedirects)" : code ? `${err.name}/${code}` : err.name
    return { url: rawUrl, status: null, finalUrl: null, crossApex: false, ms, category: "FAIL", note: kind }
  }
}

/** 跑一批 URL（并发 CONCURRENCY、每请求间隔 GAP_MS） */
async function runBatch(label: string, urls: string[]): Promise<ProbeResult[]> {
  const results: ProbeResult[] = new Array(urls.length)
  let cursor = 0
  const t0 = Date.now()

  async function worker(id: number) {
    while (cursor < urls.length) {
      const idx = cursor++
      const url = urls[idx]
      const r = await probe(url)
      results[idx] = r
      console.log(`[${label} w${id}] ${r.category.padEnd(8)} ${String(r.status ?? "-").padEnd(4)} ${r.ms}ms ${url}${r.note ? `  ← ${r.note}` : ""}`)
      await sleep(GAP_MS)
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)))
  console.log(`[${label}] 本批完成 ${urls.length} 条，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)
  return results
}

/** 对 FAIL 的 URL 做替代候选探测，返回返回 OK(2xx) 的候选 */
async function findRepairs(url: string): Promise<VerifyEntry["repairs"]> {
  const apex = domainFromUrl(url)
  if (!apex) return []
  const candidates: string[] = []
  if (/^http:\/\//i.test(url)) candidates.push(url.replace(/^http:\/\//i, "https://")) // http→https 同路径
  candidates.push(`https://www.${apex}`, `https://${apex}`)
  for (const sub of ["campus", "join", "talent", "hr", "job", "zhaopin", "careers"]) {
    candidates.push(`https://${sub}.${apex}`)
  }
  const okRepairs: VerifyEntry["repairs"] = []
  for (const c of candidates) {
    const r = await probe(c)
    console.log(`    [repair] ${r.category.padEnd(8)} ${String(r.status ?? "-").padEnd(4)} ${c}${r.note ? `  ← ${r.note}` : ""}`)
    if (r.category === "OK") okRepairs.push({ url: c, status: r.status as number, ms: r.ms })
    await sleep(GAP_MS)
  }
  return okRepairs
}

async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith("--only="))
  const doRepair = process.argv.includes("--repair")

  // 按 URL 去重（多家企业可能共用同一招聘页），并保留企业名映射
  const urlMap = new Map<string, string[]>()
  for (const c of CATALOG) {
    const list = urlMap.get(c.recruitUrl) ?? []
    list.push(c.name)
    urlMap.set(c.recruitUrl, list)
  }
  let targets = [...urlMap.keys()]
  if (onlyArg) {
    const only = new Set(onlyArg.slice("--only=".length).split(",").map((s) => s.trim()).filter(Boolean))
    targets = targets.filter((u) => only.has(u))
    console.log(`[verify] --only 模式：${only.size} 个指定 URL → 命中 ${targets.length} 条`)
  } else {
    console.log(`[verify] 目录企业 ${CATALOG.length} 家 → 唯一 URL ${targets.length} 条 · 并发 ${CONCURRENCY} · 间隔 ${GAP_MS}ms · 超时 ${TIMEOUT_MS}ms`)
  }
  console.log(`[verify] 修复模式：${doRepair ? "开（FAIL 域名做替代 URL 尝试）" : "关"}\n`)

  // 首轮
  const first = await runBatch("首轮", targets)
  const firstBy = new Map(first.map((r) => [r.url, r]))

  // FAIL 复核轮（排除瞬时网络抖动的误判）
  const failedUrls = first.filter((r) => r.category === "FAIL").map((r) => r.url)
  let finalBy = firstBy
  if (failedUrls.length > 0) {
    console.log(`[verify] ${CONFIRM_GAP_MS}ms 后复核 ${failedUrls.length} 条 FAIL ...`)
    await sleep(CONFIRM_GAP_MS)
    const second = await runBatch("复核", failedUrls)
    finalBy = new Map(firstBy)
    for (const r of second) {
      if (r.category !== "FAIL") {
        console.log(`[verify] 复核翻转（瞬态误判）${r.url} → ${r.category} ${r.status}`)
        finalBy.set(r.url, r)
      } else {
        const prev = finalBy.get(r.url)
        finalBy.set(r.url, { ...r, note: prev ? `${prev.note}；复核轮仍 FAIL` : r.note })
      }
    }
  }

  // 汇总 + 修复尝试
  const entries: VerifyEntry[] = []
  for (const [url, companies] of urlMap) {
    const r = finalBy.get(url)
    if (!r) continue // --only 未命中
    const entry: VerifyEntry = { ...r, companies, repairs: [] }
    if (doRepair && r.category === "FAIL") {
      console.log(`[repair] ${url}（${companies.join("/")}）尝试替代 URL：`)
      entry.repairs = await findRepairs(url)
    }
    entries.push(entry)
  }

  // 统计输出
  const stat = { OK: 0, SOFT: 0, REDIRECT: 0, FAIL: 0 }
  for (const e of entries) stat[e.category]++
  console.log(`\n===== 核对统计（唯一 URL ${entries.length} 条 / 企业 ${entries.reduce((n, e) => n + e.companies.length, 0)} 家）=====`)
  console.log(`OK ${stat.OK} · SOFT-反爬 ${stat.SOFT} · REDIRECT ${stat.REDIRECT} · FAIL ${stat.FAIL}`)

  const fails = entries.filter((e) => e.category === "FAIL")
  if (fails.length) {
    console.log(`\n----- FAIL 明细 -----`)
    for (const e of fails) {
      console.log(`✗ ${e.url}  [${e.companies.join("/")}]  ${e.note}`)
      for (const r of e.repairs) console.log(`   ↳ 建议修复 → ${r.url} (HTTP ${r.status}, ${r.ms}ms)`)
      if (!e.repairs.length) console.log(`   ↳ 无 OK 替代候选（按修复原则不改 catalog）`)
    }
  }
  const redirects = entries.filter((e) => e.category === "REDIRECT")
  if (redirects.length) {
    console.log(`\n----- REDIRECT 明细（跨主域跳转，仅记录不改动）-----`)
    for (const e of redirects) console.log(`⤴ ${e.url} → ${e.finalUrl} (${e.status}) [${e.companies.join("/")}]`)
  }

  writeFileSync(new URL("./verify-urls-result.json", import.meta.url), JSON.stringify({ verifiedAt: new Date().toISOString(), stat, entries }, null, 2))
  console.log(`\n[verify] 结果已写入 scripts/verify-urls-result.json`)
}

main()
