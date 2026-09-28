/**
 * 企业 LOGO 预热脚本（Task 24-c 创建，Task 25-c 升级多源重试，bun 运行）
 *
 * 流程：读 src/lib/catalog.ts 全部企业 recruitUrl → domainFromUrl 提取注册主域 →
 *       请求本机 /api/logo?domain=... 触发服务端抓取
 *       （Google s2 → favicon.im → DuckDuckGo → 官网 favicon.ico → 首页 HTML link 解析）
 *       并落盘到 public/logos/{domain}.img。
 *
 * 用法：
 *   bun scripts/warm-logos.ts                  # 全量预热（已缓存域名命中磁盘秒回，无出网）
 *   bun scripts/warm-logos.ts --retry-failed   # 增量：扫描 public/logos/ 既有缓存，只补缺失域名
 *
 * 限流友好：并发 2、每请求间隔 500ms；失败域名结尾间隔 2s 再自动重试一轮。
 * 请求带 &retry=1：跳过服务端 24h 负缓存，保证上一轮失败域名在本轮真实重抓（而非秒回 404）。
 *
 * 说明：
 * - 需要本地 dev server 已启动（默认 3000 端口，可用 LOGO_BASE_URL 环境变量覆盖）。
 * - 仍 404 的域名即六级降级链也拿不到图，前端会自动降级为行业渐变字标，属预期行为。
 * - 可重复执行：命中磁盘缓存的请求不产生出网流量，秒回。
 */

import { readdirSync, statSync } from "node:fs"
import path from "node:path"

import { CATALOG } from "../src/lib/catalog"
import { domainFromUrl } from "../src/lib/logo"

const BASE = (process.env.LOGO_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")
const RETRY_FAILED = process.argv.includes("--retry-failed")
const LOGO_DIR = path.join(import.meta.dir, "..", "public", "logos")
const CONCURRENCY = 2
const GAP_MS = 500
const RETRY_GAP_MS = 2000
const TIMEOUT_MS = 15000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 扫描磁盘缓存：public/logos/ 下 >0 字节的 {domain}.img（0 字节残文件由 API 自愈重抓，视为未缓存） */
function listCachedDomains(): Set<string> {
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

/** 跑一批域名（并发 CONCURRENCY、每请求间隔 GAP_MS），返回仍失败的域名列表 */
async function warmBatch(label: string, list: string[]): Promise<string[]> {
  const failed: string[] = []
  let cursor = 0
  let ok = 0
  const t0 = Date.now()

  async function worker(id: number) {
    while (cursor < list.length) {
      const domain = list[cursor++]
      try {
        const res = await fetch(`${BASE}/api/logo?domain=${encodeURIComponent(domain)}&retry=1`, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (res.ok) {
          ok++
          console.log(`[${label} w${id}] ✓ ${domain} (${res.status} ${Date.now() - t0}ms)`)
        } else {
          failed.push(domain)
          console.log(`[${label} w${id}] ✗ ${domain} (${res.status} ${Date.now() - t0}ms)`)
        }
      } catch (e) {
        failed.push(domain)
        console.log(`[${label} w${id}] ✗ ${domain} (${(e as Error).name}: ${(e as Error).message})`)
      }
      await sleep(GAP_MS)
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)))
  console.log(`[${label}] 完成（${((Date.now() - t0) / 1000).toFixed(1)}s）：成功 ${ok} / 失败 ${failed.length} / 共 ${list.length}`)
  return failed
}

async function main() {
  // 去重后的唯一域名集合（多家企业可能同域，如 集团 / 子品牌共用主站）
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

  // --retry-failed 增量模式：只跑磁盘上还没有的域名（24-c 时代出网限流只缓存了一小部分，靠这里补齐）
  let targets = domains
  if (RETRY_FAILED) {
    const cached = listCachedDomains()
    targets = domains.filter((d) => !cached.has(d))
    console.log(`[warm-logos] --retry-failed 增量模式：磁盘已缓存 ${cached.size} 个 / 目录唯一域名 ${domains.length} 个 → 本次待补 ${targets.length} 个`)
  } else {
    console.log(`[warm-logos] 目录企业 ${CATALOG.length} 家 → 唯一域名 ${domains.length} 个（无法提取域名 ${noDomain} 家，前端走字标）`)
  }
  if (targets.length === 0) {
    console.log(`[warm-logos] 无待补域名，全部已缓存 ✓`)
    return
  }
  console.log(`[warm-logos] 目标服务：${BASE}/api/logo · 并发 ${CONCURRENCY} · 间隔 ${GAP_MS}ms · retry=1 跳过服务端负缓存\n`)

  // 首轮 + 失败域名重试一轮（间隔 2s 等限流窗口过去）
  const firstFailed = await warmBatch("首轮", targets)
  let finalFailed = firstFailed
  if (firstFailed.length > 0) {
    console.log(`\n[warm-logos] ${RETRY_GAP_MS}ms 后重试 ${firstFailed.length} 个失败域名...`)
    await sleep(RETRY_GAP_MS)
    finalFailed = await warmBatch("重试", firstFailed)
  }

  if (finalFailed.length) {
    console.log(
      `\n[warm-logos] 仍失败 ${finalFailed.length} 个（前端自动降级为行业渐变字标；可稍后重跑本脚本补抓）：\n  ${finalFailed.join("\n  ")}`,
    )
  } else {
    console.log(`\n[warm-logos] 本批全部缓存成功 ✓`)
  }
  console.log(`[warm-logos] 缓存目录：public/logos/*.img，可随时删除单文件强制重抓。`)
}

main()
