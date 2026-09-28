/**
 * 企业 LOGO 预热 · 可复用模块（Task 27-a 自 scripts/warm-logos.ts 抽取）
 *
 * 流程：目录/显式域名列表 → domainFromUrl 提取注册主域去重 →（可选增量：跳过磁盘已缓存）→
 *       逐域请求 /api/logo?domain=...&retry=1 触发服务端七级降级链抓取并落盘 public/logos/{domain}.img。
 *
 * 两种传输方式：
 *   - "http"（默认）：HTTP 调用 ${baseUrl}/api/logo —— CLI 脚本用，行为与原 warm-logos.ts 完全一致
 *   - "in-process"：直接 import /api/logo 的 GET 处理器同进程调用 —— 调度器用，不依赖端口/网关
 *
 * 限流：并发 2、每请求间隔 500ms、单请求 15s 超时；失败域名结尾间隔 2s 自动重试一轮。
 * retry=1：跳过服务端 24h 负缓存，保证失败域名真实重抓（磁盘命中仍秒回，不受影响）。
 * 所有网络请求 try/catch 不外逸；返回统计结果，失败域名由调用方决定是否记日志/重试。
 */

import { readdirSync, statSync } from "node:fs"
import path from "node:path"

import { CATALOG } from "./catalog"
import { domainFromUrl } from "./logo"

const LOGO_DIR = path.join(process.cwd(), "public", "logos")
const DEFAULT_BASE_URL = (process.env.LOGO_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")
const DEFAULT_CONCURRENCY = 2
const DEFAULT_GAP_MS = 500
const DEFAULT_RETRY_GAP_MS = 2000
const DEFAULT_TIMEOUT_MS = 15000

export interface WarmLogosOptions {
  /** 增量模式：只补磁盘上还没有的域名（缺失/失败），已缓存域名秒回跳过 */
  retryFailed?: boolean
  /** 显式指定域名列表；不传则取 catalog 全部企业 recruitUrl 的去重主域 */
  domains?: string[]
  concurrency?: number
  gapMs?: number
  /** 失败域名重试轮前的间隔 */
  retryGapMs?: number
  timeoutMs?: number
  /** http 传输的服务地址（默认 LOGO_BASE_URL 环境变量或 http://localhost:3000） */
  baseUrl?: string
  /** 传输方式：http=走本机 API（默认，CLI 兼容）；in-process=直接调用 /api/logo 处理器 */
  transport?: "http" | "in-process"
  /** 日志输出（默认 console.log） */
  log?: (line: string) => void
}

export interface WarmLogosResult {
  /** 目录唯一域名总数（retryFailed 增量时为待补前总量） */
  catalogDomains: number
  /** 本次实际待补域名数 */
  total: number
  /** 增量模式跳过的已缓存域名数 */
  cachedSkipped: number
  ok: number
  failed: number
  failedDomains: string[]
  elapsedMs: number
}

/** 扫描磁盘缓存：public/logos/ 下 >0 字节的 {domain}.img（0 字节残文件由 API 自愈重抓，视为未缓存） */
export function listCachedDomains(): Set<string> {
  const cached = new Set<string>()
  let names: string[]
  try {
    names = readdirSync(LOGO_DIR)
  } catch {
    return cached // 目录尚不存在 = 零缓存
  }
  for (const name of names) {
    if (!name.endsWith(".img")) continue
    try {
      if (statSync(path.join(LOGO_DIR, name)).size > 0) cached.add(name.slice(0, -4))
    } catch {
      // 文件刚好被清理等竞态，忽略
    }
  }
  return cached
}

/** catalog 全部企业 recruitUrl → 去重后的唯一注册主域列表 */
export function catalogLogoDomains(): { domains: string[]; noDomain: number } {
  const seen = new Set<string>()
  const domains: string[] = []
  let noDomain = 0
  for (const c of CATALOG) {
    const d = domainFromUrl(c.recruitUrl)
    if (!d) {
      noDomain++
      continue
    }
    if (!seen.has(d)) {
      seen.add(d)
      domains.push(d)
    }
  }
  return { domains, noDomain }
}

/** 抓取单个域名（两种传输方式），返回是否成功 */
async function fetchOne(domain: string, opts: Required<Pick<WarmLogosOptions, "transport" | "baseUrl" | "timeoutMs">>): Promise<boolean> {
  const url = `http://fanlai.internal/api/logo?domain=${encodeURIComponent(domain)}&retry=1`
  if (opts.transport === "in-process") {
    // 同进程直接调用 /api/logo 处理器：不依赖端口，也不经网络栈
    const { GET } = await import("../app/api/logo/route")
    const res = await GET(new Request(url))
    await res.arrayBuffer().catch(() => {}) // 排空 body（磁盘命中时也统一消费，保持语义一致）
    return res.ok
  }
  const res = await fetch(`${opts.baseUrl}/api/logo?domain=${encodeURIComponent(domain)}&retry=1`, {
    signal: AbortSignal.timeout(opts.timeoutMs),
  })
  await res.arrayBuffer().catch(() => {})
  return res.ok
}

/**
 * 跑一轮 LOGO 预热（并发 concurrency、每请求间隔 gapMs；失败域名间隔 retryGapMs 后自动重试一轮）。
 * 不抛出：单域名失败计入 failedDomains，网络/DB 异常就地吞掉。
 */
export async function warmLogos(opts?: WarmLogosOptions): Promise<WarmLogosResult> {
  const log = opts?.log ?? ((line: string) => console.log(line))
  const concurrency = Math.max(1, opts?.concurrency ?? DEFAULT_CONCURRENCY)
  const gapMs = opts?.gapMs ?? DEFAULT_GAP_MS
  const retryGapMs = opts?.retryGapMs ?? DEFAULT_RETRY_GAP_MS
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const transport = opts?.transport ?? "http"
  const baseUrl = (opts?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "")
  const t0 = Date.now()

  const result: WarmLogosResult = {
    catalogDomains: 0,
    total: 0,
    cachedSkipped: 0,
    ok: 0,
    failed: 0,
    failedDomains: [],
    elapsedMs: 0,
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  try {
    // 目标域名集合（显式指定优先；否则取 catalog 去重）
    let domains: string[]
    if (opts?.domains?.length) {
      domains = [...new Set(opts.domains)]
      result.catalogDomains = domains.length
      log(`[warm-logos] 指定域名 ${domains.length} 个`)
    } else {
      const { domains: cd, noDomain } = catalogLogoDomains()
      domains = cd
      result.catalogDomains = cd.length
      log(`[warm-logos] 目录企业 ${CATALOG.length} 家 → 唯一域名 ${cd.length} 个（无法提取域名 ${noDomain} 家，前端走字标）`)
    }

    // --retry-failed 增量模式：只跑磁盘上还没有的域名
    let targets = domains
    if (opts?.retryFailed) {
      const cached = listCachedDomains()
      targets = domains.filter((d) => !cached.has(d))
      result.cachedSkipped = domains.length - targets.length
      log(`[warm-logos] 增量模式：磁盘已缓存 ${cached.size} 个 / 唯一域名 ${domains.length} 个 → 本次待补 ${targets.length} 个`)
    }
    result.total = targets.length
    if (targets.length === 0) {
      log(`[warm-logos] 无待补域名，全部已缓存 ✓`)
      result.elapsedMs = Date.now() - t0
      return result
    }
    log(`[warm-logos] 传输 ${transport === "in-process" ? "in-process（同进程直调 /api/logo）" : baseUrl + "/api/logo"} · 并发 ${concurrency} · 间隔 ${gapMs}ms · retry=1 跳过服务端负缓存`)

    const fetchOpts = { transport, baseUrl, timeoutMs }

    // 跑一批（并发 concurrency、每请求间隔 gapMs），返回仍失败的域名列表
    const warmBatch = async (label: string, list: string[]): Promise<string[]> => {
      const failed: string[] = []
      let ok = 0
      let cursor = 0

      async function worker(id: number) {
        while (cursor < list.length) {
          const domain = list[cursor++]
          try {
            const good = await fetchOne(domain, fetchOpts)
            if (good) {
              ok++
              log(`[${label} w${id}] ✓ ${domain}`)
            } else {
              failed.push(domain)
              log(`[${label} w${id}] ✗ ${domain}（七级降级链全部未命中）`)
            }
          } catch (e) {
            failed.push(domain)
            log(`[${label} w${id}] ✗ ${domain}（${(e as Error).name}: ${(e as Error).message.slice(0, 80)}）`)
          }
          await sleep(gapMs)
        }
      }

      await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i + 1)))
      log(`[${label}] 完成：成功 ${ok} / 失败 ${failed.length} / 共 ${list.length}`)
      return failed
    }

    // 首轮 + 失败域名重试一轮（间隔 retryGapMs 等限流窗口过去）
    const firstFailed = await warmBatch("首轮", targets)
    let finalFailed = firstFailed
    if (firstFailed.length > 0) {
      log(`[warm-logos] ${retryGapMs}ms 后重试 ${firstFailed.length} 个失败域名...`)
      await sleep(retryGapMs)
      finalFailed = await warmBatch("重试", firstFailed)
    }

    result.ok = targets.length - finalFailed.length
    result.failed = finalFailed.length
    result.failedDomains = finalFailed
    if (finalFailed.length) {
      log(`[warm-logos] 仍失败 ${finalFailed.length} 个（前端自动降级为行业渐变字标；可稍后重跑补抓）：\n  ${finalFailed.join("\n  ")}`)
    } else {
      log(`[warm-logos] 本批全部缓存成功 ✓`)
    }
    log(`[warm-logos] 缓存目录：public/logos/*.img，可随时删除单文件强制重抓。`)
  } catch (e) {
    // 兜底：预热失败绝不外逸（调用方多在调度链上）
    log(`[warm-logos] 预热流程异常中止：${(e as Error).message.slice(0, 120)}`)
    result.failedDomains = result.failedDomains.length ? result.failedDomains : []
  }
  result.elapsedMs = Date.now() - t0
  return result
}
