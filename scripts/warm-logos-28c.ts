/**
 * Task 28-c 一次性脚本：LOGO 多源补全（Clearbit/unavatar）全量重跑
 *
 * 背景：/api/logo 七级降级链新增 ④ logo.clearbit.com / ⑤ unavatar.io 两级后，
 *       历史失败域名（含 24h 负缓存命中的）需要全量真实重抓一次——
 *       不只 retry-failed，而是对「prisma Company 里真实存在、磁盘上还没有缓存文件」的每个域名跑一遍 warm。
 *       recruitUrl 核验 fail 的企业同样参与（LOGO 源与官网可达性无关）。
 *
 * 流程：
 *   Round 0  读 db Company 全表 → domainFromUrl 提取注册主域去重（与前端请求 /api/logo 完全同口径）
 *            → 减去磁盘已缓存 → 得缺失域名清单（按名录中出现频次降序，频次高的优先）
 *   Round 1  warmLogos({ domains: 缺失域名 })——首轮 + 失败自动重试一轮（并发 2、间隔 500ms、retry=1 跳负缓存）
 *   Round 2  仍缺域名 → 域名变体（www. / careers. / campus. 子域，很多企业 LOGO 在招聘子域上）：
 *            变体已在磁盘缓存 → 直接拷贝；否则逐个走 /api/logo 抓取，命中后把变体字节落到 {原域}.img
 *   Round 3  终局统计（前后对比、仍缺清单）+ 全缓存目录魔数审计（防 HTML 错误页混入）
 *
 * 限流：Round 1 并发 2、每请求间隔 500ms；Round 2 串行、每请求间隔 600ms、429 退避 20s（至多 1 次重试）；
 *       总时长预算 21 分钟（为审计与报告留出余量，硬性不超过 25 分钟）。
 *
 * 用法：bun scripts/warm-logos-28c.ts
 */

import { promises as fsp } from "node:fs"
import path from "node:path"

import { PrismaClient } from "@prisma/client"

import { domainFromUrl } from "../src/lib/logo"
import { listCachedDomains, warmLogos } from "../src/lib/logo-warm"

const BASE_URL = (process.env.LOGO_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")
const LOGO_DIR = path.join(process.cwd(), "public", "logos")
const VARIANT_GAP_MS = 600
const RATE_LIMIT_BACKOFF_MS = 20_000
const REQUEST_TIMEOUT_MS = 90_000 // 服务端七级链理论最坏 ~65s（各源 5s/6s 超时串行），客户端放宽到 90s 防误判
const TOTAL_BUDGET_MS = 21 * 60 * 1000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = (line: string) => console.log(line)

/** 魔数嗅探（与 /api/logo route.ts 同逻辑的独立副本：Next route 文件不宜导出非处理器符号） */
function contentTypeOf(buf: Buffer): string {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png"
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg"
  if (buf.length >= 6) {
    const head6 = buf.subarray(0, 6).toString("latin1")
    if (head6 === "GIF87a" || head6 === "GIF89a") return "image/gif"
  }
  if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return "image/x-icon"
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP")
    return "image/webp"
  const head = buf.subarray(0, 200).toString("utf8").trimStart().toLowerCase()
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "image/svg+xml"
  return "application/octet-stream"
}

/** 把字节原子写入 {domain}.img（临时文件 + 改名，与 route.ts writeCache 同规则） */
async function writeCacheFile(domain: string, buf: Buffer): Promise<void> {
  await fsp.mkdir(LOGO_DIR, { recursive: true })
  const target = path.join(LOGO_DIR, `${domain}.img`)
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  await fsp.writeFile(tmp, buf)
  await fsp.rename(tmp, target)
}

/** 单个变体域名抓取：429 退避 20s 重试一次；返回是否拿到缓存文件 */
async function fetchVariant(v: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/api/logo?domain=${encodeURIComponent(v)}&retry=1`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      await res.arrayBuffer().catch(() => {})
      if (res.status === 429) {
        log(`    [429] ${v} → 退避 ${RATE_LIMIT_BACKOFF_MS / 1000}s 后重试`)
        await sleep(RATE_LIMIT_BACKOFF_MS)
        continue
      }
      return res.ok
    } catch {
      return false
    }
  }
  return false
}

async function main(): Promise<void> {
  const t0 = Date.now()
  const prisma = new PrismaClient()
  try {
    // ---- Round 0：目标集合 ----
    const companies = await prisma.company.findMany({
      select: { name: true, recruitUrl: true, urlStatus: true },
    })
    const namesByDomain = new Map<string, string[]>()
    const statusByDomain = new Map<string, Set<string>>()
    const countByDomain = new Map<string, number>()
    let noDomain = 0
    for (const c of companies) {
      const d = domainFromUrl(c.recruitUrl)
      if (!d) {
        noDomain++
        continue
      }
      countByDomain.set(d, (countByDomain.get(d) ?? 0) + 1)
      const names = namesByDomain.get(d) ?? []
      names.push(c.name)
      namesByDomain.set(d, names)
      const st = statusByDomain.get(d) ?? new Set<string>()
      if (c.urlStatus) st.add(c.urlStatus)
      statusByDomain.set(d, st)
    }
    const allDomains = [...countByDomain.keys()]
    const cachedBefore = listCachedDomains()
    const missing = allDomains
      .filter((d) => !cachedBefore.has(d))
      .sort((a, b) => (countByDomain.get(b) ?? 0) - (countByDomain.get(a) ?? 0))
    const statusLabel = (d: string) => [...(statusByDomain.get(d) ?? new Set<string>())].sort().join("+") || "-"
    log(`[28-c] 企业 ${companies.length} 家（无法提取域名 ${noDomain} 家）→ 唯一域名 ${allDomains.length} 个 / 磁盘已缓存 ${cachedBefore.size} 个 → 待补 ${missing.length} 个（含核验 fail 域 ${missing.filter((d) => (statusByDomain.get(d) ?? new Set()).has("fail")).length} 个）`)
    log(`[28-c] 待补清单：${missing.map((d) => `${d}(${statusLabel(d)})`).join(", ")}`)

    // ---- Round 1：全量 warm（首轮 + 失败自动重试一轮；并发 2、间隔 500ms）----
    if (missing.length > 0) {
      await warmLogos({
        domains: missing,
        transport: "http",
        baseUrl: BASE_URL,
        concurrency: 2,
        gapMs: 500,
        retryGapMs: 2500,
        timeoutMs: REQUEST_TIMEOUT_MS,
        log,
      })
    } else {
      log("[28-c] 无待补域名，全部已缓存 ✓")
    }

    // ---- Round 2：仍缺域名 → 域名变体（www./careers./campus. 子域）----
    let cachedNow = listCachedDomains()
    const fixedByRound1 = missing.filter((d) => cachedNow.has(d))
    let stillMissing = missing.filter((d) => !cachedNow.has(d))
    const fixedByVariant: string[] = []
    log(`[28-c] Round1 补上 ${fixedByRound1.length} 个，仍缺 ${stillMissing.length} 个 → 域名变体轮（www. / careers. / campus.）`)

    variantLoop: for (const d of stillMissing) {
      for (const v of [`www.${d}`, `careers.${d}`, `campus.${d}`]) {
        if (Date.now() - t0 > TOTAL_BUDGET_MS) {
          log(`[28-c] ⏱ 已达 ${TOTAL_BUDGET_MS / 60000} 分钟预算，变体轮提前收尾（剩余域名下轮再补）`)
          break variantLoop
        }
        await sleep(VARIANT_GAP_MS)
        // 变体已有磁盘缓存（任何来源写入的）→ 直接拷贝，零出网
        const variantFile = path.join(LOGO_DIR, `${v}.img`)
        try {
          const st = await fsp.stat(variantFile)
          if (st.size > 0) {
            await writeCacheFile(d, await fsp.readFile(variantFile))
            await fsp.unlink(variantFile).catch(() => {})
            fixedByVariant.push(d)
            log(`  [变体拷贝] ${v}.img → ${d}.img ✓`)
            continue variantLoop
          }
        } catch {
          // 变体无缓存 → 出网抓取
        }
        const ok = await fetchVariant(v)
        if (ok) {
          try {
            const buf = await fsp.readFile(variantFile)
            if (buf.length > 0) {
              await writeCacheFile(d, buf)
              await fsp.unlink(variantFile).catch(() => {})
              fixedByVariant.push(d)
              log(`  [变体抓取] ${v} → ${d}.img ✓ (${buf.length}B)`)
              continue variantLoop
            }
          } catch {
            // 200 但文件读不到（极端竞争）→ 继续下一变体
          }
        }
        log(`  [变体] ${v} 未命中`)
      }
    }

    // ---- Round 3：终局统计 + 全目录魔数审计 ----
    cachedNow = listCachedDomains()
    stillMissing = missing.filter((d) => !cachedNow.has(d))
    const newlyCached = allDomains.filter((d) => !cachedBefore.has(d) && cachedNow.has(d))
    log(`\n========== 28-c 统计 ==========`)
    log(`缺失域名：${missing.length} → ${stillMissing.length}（补上 ${missing.length - stillMissing.length} 个，其中 Round1=${fixedByRound1.length}、变体轮=${fixedByVariant.length}）`)
    log(`缓存文件总数：${cachedBefore.size} → ${cachedNow.size}`)
    if (newlyCached.length) log(`本轮新增：${newlyCached.join(", ")}`)
    if (stillMissing.length) {
      log(`仍缺 ${stillMissing.length} 个（企业名 · 核验状态）：`)
      for (const d of stillMissing.slice(0, 20)) {
        log(`  ${d} [${statusLabel(d)}] ${namesByDomain.get(d)?.join("、") ?? ""}`)
      }
      if (stillMissing.length > 20) log(`  ...等共 ${stillMissing.length} 个`)
    }

    // 魔数审计：0 字节 / HTML 伪装 → 删除自愈；未知二进制 → 只报告不删
    const polluted: string[] = []
    let scanned = 0
    for (const name of await fsp.readdir(LOGO_DIR)) {
      if (!name.endsWith(".img")) continue
      const file = path.join(LOGO_DIR, name)
      let buf: Buffer
      try {
        buf = await fsp.readFile(file)
      } catch {
        continue
      }
      scanned++
      const ct = contentTypeOf(buf)
      if (ct === "image/svg+xml") continue // 合法图标
      if (ct === "application/octet-stream") {
        const head = buf.subarray(0, 64).toString("utf8").trimStart().toLowerCase()
        if (buf.length === 0 || head.startsWith("<") || head.startsWith("text/html") || head.includes("<!doctype html")) {
          polluted.push(name)
          await fsp.unlink(file).catch(() => {})
        } else {
          log(`[审计] 非常规魔数（保留待观察）：${name} (${buf.length}B, 头 ${buf.subarray(0, 8).toString("hex")})`)
        }
      }
    }
    log(`[审计] 扫描 ${scanned} 个缓存文件，删除伪造/残缺 ${polluted.length} 个${polluted.length ? "：" + polluted.join(", ") : " ✓ 无 HTML 错误页混入"}`)
    log(`[28-c] 总耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  } finally {
    await prisma.$disconnect().catch(() => {})
  }
}

main()
