// 饭来情报站 · 行业情报检索管道（Task 28-e）
// —— 每日（主同步成功后链式）用 z-ai-web-dev-sdk 的 web_search 抓一轮行业新闻：
//    校招政策 / 行业动态 / 产品更迭 / 标准发布 / 职场观察 五类关键词各一组，
//    清洗（去 HTML 实体、摘要截 120 字）→ 过滤 UGC 噪音域 → url 去重入库。
// 池子容量：每类保留最近 ≤20 条，总池 ≤100 条（旧的按 fetchedAt 清理）。
//
// 存取说明：NewsItem 是运行中 dev server 新增的模型，进程内 Prisma client 的 DMMF
// 可能尚未认识它（与 /api/verify 对新列的策略一致）——全部走 $queryRaw/$executeRaw
// 直读 SQLite，重启前后行为一致。
// ZAI SDK 仅在本文件（src/lib/**）服务端使用，绝不出现在组件里。

import ZAI from "z-ai-web-dev-sdk"
import { db } from "@/lib/db"

export const NEWS_CATEGORIES = ["行业动态", "产品更迭", "标准发布", "校招政策", "职场观察"] as const
export type NewsCategory = (typeof NEWS_CATEGORIES)[number]

/** 单轮检索的关键词组（每轮 5 组，分类映射到 NEWS_CATEGORIES；措辞偏新闻公告而非门户页） */
const QUERY_GROUPS: { query: string; category: NewsCategory }[] = [
  { query: "2027届 秋招 启动 网申", category: "校招政策" },
  { query: "智能制造 制造业 工厂 新闻", category: "行业动态" },
  { query: "消费电子 新品 发布会 亮相", category: "产品更迭" },
  { query: "新能源汽车 销量 出口 动态", category: "行业动态" },
  { query: "行业标准 新规 发布 实施", category: "标准发布" },
]

/** web_search 单条结果（与 sync-job 的 SearchItem 同形，独立声明避免跨模块耦合） */
interface NewsSearchItem {
  url?: string
  name?: string
  snippet?: string
  host_name?: string
  date?: string
}

/** 入库行（raw SQL 读出口径：时间均为 ms 时间戳） */
export interface NewsRow {
  id: string
  category: string
  title: string
  summary: string
  url: string
  source: string
  publishedAt: number | null
  fetchedAt: number
}

/** 一轮检索的结果快照（日志与 /api/news 透出用） */
export interface NewsJobResult {
  seen: number // 检索到的原始条数
  inserted: number // 新入池条数
  duplicated: number // url 已存在被跳过
  filtered: number // 被 UGC 域名/无效字段过滤
  failedQueries: number
  poolTotal: number
  message: string
}

// ── job 状态：挂在 globalThis，dev 模式模块重载/多路由共享同一份 ──
interface NewsJobState {
  running: boolean
  startedAt: number
  finishedAt: number | null
  result: NewsJobResult | null
  error: string | null
}

const g = globalThis as unknown as { __fanlaiNewsJob?: NewsJobState }
const state: NewsJobState = (g.__fanlaiNewsJob ??= {
  running: false,
  startedAt: 0,
  finishedAt: null,
  result: null,
  error: null,
})

export function isNewsRunning(): boolean {
  return state.running
}

export function newsJobSnapshot(): { running: boolean; lastFinishedAt: string | null; error: string | null } {
  return {
    running: state.running,
    lastFinishedAt: state.finishedAt ? new Date(state.finishedAt).toISOString() : null,
    error: state.error,
  }
}

// ── 清洗工具 ──

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&middot;": "·",
  "&mdash;": "—",
  "&hellip;": "…",
  "&ldquo;": "「",
  "&rdquo;": "」",
}

/** 标题/摘要清洗：去标签 → 解常见 HTML 实体（含数字码）→ 压空白 */
function cleanText(raw: string | undefined | null): string {
  if (!raw) return ""
  let s = String(raw).replace(/<[^>]*>/g, " ")
  for (const [k, v] of Object.entries(ENTITIES)) s = s.split(k).join(v)
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
    try {
      return String.fromCodePoint(parseInt(h, 16))
    } catch {
      return ""
    }
  })
  s = s.replace(/&#(\d+);/g, (_, d) => {
    try {
      return String.fromCodePoint(parseInt(d, 10))
    } catch {
      return ""
    }
  })
  return s.replace(/\s+/g, " ").trim()
}

/** 摘要截 120 字（按码点，避免中文被截成乱码） */
function clamp120(s: string): string {
  const chars = Array.from(s)
  return chars.length > 120 ? chars.slice(0, 120).join("") + "…" : s
}

/** 从 url 提取来源域名（去 www.），失败返回 null */
function domainOf(u: string | undefined): string | null {
  if (!u) return null
  try {
    const host = new URL(u).hostname.replace(/^www\./, "")
    return host.includes(".") ? host : null
  } catch {
    return null
  }
}

/** UGC 噪音域黑名单（回答页/社区贴一类，不进情报流） */
const UGC_BLOCK = new Set([
  "zhihu.com",
  "tieba.baidu.com",
  "weibo.com",
  "weibo.cn",
  "xiaohongshu.com",
  "douban.com",
  "baijiahao.baidu.com",
  "baike.baidu.com",
  "zhidao.baidu.com",
  "wen.baidu.com",
  "wenku.baidu.com",
])

function isUgcDomain(host: string): boolean {
  return [...UGC_BLOCK].some((d) => host === d || host.endsWith(`.${d}`))
}

/** 门户/列表页标题特征：命中即弃（情报流要的是文章，不是站点入口） */
const HUB_TITLE_PATTERNS: RegExp[] = [
  /(新闻|资讯|动态)\s*[-_－—·・|｜]/, // 「新能源_新华汽车」「关于车的新闻 - 智车之家」
  /[-_－—·・|｜]\s*(新闻|资讯|动态|频道|专题)(网|中心)?$/,
  /(新闻网|资讯网|招聘网|人才网|新闻中心)$/,
  /(官网|官方网站|官方下载|官方app)$/i,
  /(校园招聘|社会招聘|招聘信息)$/, // 门户列表页；真公告多为「XX启动/开启」带动词，不会命中
  /(服务商|数据平台|解决方案)$/, // B2B 落地页
  /(首页|汇总|大全|数据统计|数据中心|岗位列表)$/, // 门户/聚合页
  /信息汇总/,
  /(市场规模|份额|市场分析|行业报告)([、,，]\s*份额.*)?$/,
  /(-m站|m站|直击|盘点|合集|专题报道)$/, // 展会直播/清单页
  /最新动态|热招职位|职位列表|求职app/i,
]

/** 标题尾部的站点名回声：「XX文章 - 中国经济网」→「XX文章」 */
function stripSourceEcho(title: string): string {
  const parts = title.split(/\s*[|｜]\s*|\s[-–—]\s\s*|-{3,}/).map((p) => p.trim()).filter(Boolean)
  if (parts.length <= 1) return title.trim()
  const head = parts[0]
  return head.length >= 8 ? head : title.trim()
}

/** 摘要开头的日期前缀（「2026年6月12日 — 正文」）：解析成时间戳并从摘要中剥掉 */
function extractSnippetDate(snippet: string): { date: number | null; body: string } {
  const m = snippet.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日\s*[—－-]*\s*/)
  if (!m) return { date: null, body: snippet }
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0).getTime()
  return { date: Number.isNaN(t) ? null : t, body: snippet.slice(m[0].length).trim() }
}

/** 结果日期解析：web_search 的 date 多为 YYYY-MM-DD 或近似格式，解析失败回退 null */
function parsePublishDate(raw: string | undefined): number | null {
  if (!raw) return null
  const t = Date.parse(raw.trim())
  return Number.isNaN(t) ? null : t
}

/** 分类细分：组默认分类 + 标题关键词轻修正（确定性，无 LLM） */
function classify(title: string, fallback: NewsCategory): NewsCategory {
  if (/校招|秋招|春招|应届|校园招聘|网申|管培生/.test(title)) return "校招政策"
  if (/标准|规范|白皮书|管理办法|征求意见/.test(title)) return "标准发布"
  if (/新品|发布|上市|上线|迭代|推出|亮相|首发/.test(title)) return "产品更迭"
  if (/职场|就业|薪资|求职|人才|失业|用工|裁员/.test(title)) return "职场观察"
  return fallback
}

// ── 池子维护（raw SQL）──

let idSeq = 0
function makeId(): string {
  idSeq = (idSeq + 1) % 1_000_000
  return `news_${Date.now().toString(36)}_${idSeq.toString(36)}_${Math.floor(Math.random() * 1e8).toString(36)}`
}

/** 每类保留最近 20 条、总池保留最近 100 条（按 fetchedAt） */
async function pruneNewsPool(): Promise<void> {
  for (const cat of NEWS_CATEGORIES) {
    await db.$executeRaw`DELETE FROM "NewsItem" WHERE "category" = ${cat} AND "id" NOT IN (
      SELECT "id" FROM (SELECT "id" FROM "NewsItem" WHERE "category" = ${cat} ORDER BY "fetchedAt" DESC LIMIT 20)
    )`
  }
  await db.$executeRaw`DELETE FROM "NewsItem" WHERE "id" NOT IN (
    SELECT "id" FROM (SELECT "id" FROM "NewsItem" ORDER BY "fetchedAt" DESC LIMIT 100)
  )`
}

export async function newsPoolStats(): Promise<{ total: number; byCategory: Record<string, number>; lastFetchedAt: number | null }> {
  // SQLite 聚合结果可能回传 BigInt：统一 Number() 归一，避免混算抛错
  const rows = await db.$queryRaw<{ category: string; n: number; latest: number | null }[]>`
    SELECT "category", COUNT(*) as n, MAX("fetchedAt") as latest FROM "NewsItem" GROUP BY "category"`
  const byCategory: Record<string, number> = {}
  let total = 0
  let latest: number | null = null
  for (const r of rows) {
    const n = Number(r.n)
    byCategory[r.category] = n
    total += n
    const l = r.latest === null || r.latest === undefined ? null : Number(r.latest)
    if (l !== null && (latest === null || l > latest)) latest = l
  }
  return { total, byCategory, lastFetchedAt: latest }
}

// ── 主流程 ──

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 跑一轮行业情报检索（5 组关键词 × 8 条，recency 3 天）。
 * 全链路 try/catch：任何失败只记日志/状态，不向调用方抛出。
 * 返回 started=false 表示已有轮次在跑（模块级互斥）。
 */
export async function runNewsJob(): Promise<{ started: boolean; reason?: string }> {
  if (state.running) return { started: false, reason: "已有情报轮在跑" }
  state.running = true
  state.startedAt = Date.now()
  state.error = null

  const seen = { seen: 0, inserted: 0, duplicated: 0, filtered: 0, failedQueries: 0 }
  const roundTitles = new Set<string>() // 本轮内同名标题去重（跨站同文）
  const startedAt = Date.now()

  try {
    const zai = await ZAI.create()

    for (const group of QUERY_GROUPS) {
      try {
        const res = await zai.functions.invoke("web_search", { query: group.query, num: 8, recency_days: 3 })
        const items = Array.isArray(res) ? (res as NewsSearchItem[]) : []
        seen.seen += items.length

        for (const item of items) {
          const url = (item.url ?? "").trim()
          const host = domainOf(item.host_name) ?? domainOf(url)
          const rawTitle = cleanText(item.name)
          const title = stripSourceEcho(rawTitle)
          if (!url || !/^https?:\/\//.test(url) || title.length < 10 || !host || isUgcDomain(host)) {
            seen.filtered++
            continue
          }
          if (HUB_TITLE_PATTERNS.some((re) => re.test(title))) {
            seen.filtered++
            continue
          }
          // 摘要清洗：剥日期前缀（作发布时间）→ 截 120 字
          const cleanedSnippet = cleanText(item.snippet)
          const { date: snippetDate, body: snippetBody } = extractSnippetDate(cleanedSnippet)
          const summary = clamp120(snippetBody || title)
          const publishedAt = parsePublishDate(item.date) ?? snippetDate
          // 发布时间可解析但过旧（>45 天）→ 搜索引擎 recency 是软约束，这里硬一批
          if (publishedAt !== null && Date.now() - publishedAt > 45 * 86400_000) {
            seen.filtered++
            continue
          }
          // 双重去重：url 唯一约束 + 本轮内同名标题（跨站同文转载）
          if (roundTitles.has(title)) {
            seen.duplicated++
            continue
          }
          const exists = await db.$queryRaw<{ url: string }[]>`SELECT "url" FROM "NewsItem" WHERE "url" = ${url} LIMIT 1`
          if (exists.length > 0) {
            seen.duplicated++
            continue
          }
          const sameTitle = await db.$queryRaw<{ title: string }[]>`SELECT "title" FROM "NewsItem" WHERE "title" = ${title} LIMIT 1`
          if (sameTitle.length > 0) {
            seen.duplicated++
            continue
          }
          roundTitles.add(title)
          const category = classify(title, group.category)
          try {
            await db.$executeRaw`INSERT INTO "NewsItem" ("id", "category", "title", "summary", "url", "source", "publishedAt", "fetchedAt")
              VALUES (${makeId()}, ${category}, ${title}, ${summary}, ${url}, ${host}, ${publishedAt}, ${Date.now()})`
            seen.inserted++
          } catch {
            // 唯一约束冲突（并发重复）等写入失败：按重复计
            seen.duplicated++
          }
        }
      } catch (e) {
        seen.failedQueries++
        console.log(`[news-job] 查询「${group.query}」失败（不中断本轮）：${(e as Error).message.slice(0, 120)}`)
      }
      // 组间轻限流，降低被搜索服务限流的概率
      await sleep(500)
    }

    await pruneNewsPool()
    const { total } = await newsPoolStats()

    const result: NewsJobResult = {
      ...seen,
      poolTotal: total,
      message: `入池 ${seen.inserted} 条（重复 ${seen.duplicated} · 过滤 ${seen.filtered} · 失败查询 ${seen.failedQueries}），池内共 ${total} 条`,
    }
    state.result = result
    state.finishedAt = Date.now()
    console.log(
      `[news-job] 行业情报轮完成（${Math.round((Date.now() - startedAt) / 1000)}s）：${result.message}`
    )
    return { started: true }
  } catch (e) {
    state.error = (e as Error).message.slice(0, 200)
    state.finishedAt = Date.now()
    console.log(`[news-job] 行业情报轮失败（不抛出）：${state.error}`)
    return { started: true }
  } finally {
    state.running = false
  }
}

// ── 读取（/api/news GET 用）──

/** 按入池时间倒序取情报列表；category 过滤、limit 上限 100 */
export async function listNews(category: string | null, limit: number): Promise<NewsRow[]> {
  const lim = Math.min(100, Math.max(1, Math.floor(limit)))
  const rows = category
    ? await db.$queryRaw<{ id: string; category: string; title: string; summary: string; url: string; source: string; publishedAt: number | null; fetchedAt: number }[]>`
        SELECT "id", "category", "title", "summary", "url", "source", "publishedAt", "fetchedAt"
        FROM "NewsItem" WHERE "category" = ${category}
        ORDER BY "fetchedAt" DESC LIMIT ${lim}`
    : await db.$queryRaw<{ id: string; category: string; title: string; summary: string; url: string; source: string; publishedAt: number | null; fetchedAt: number }[]>`
        SELECT "id", "category", "title", "summary", "url", "source", "publishedAt", "fetchedAt"
        FROM "NewsItem"
        ORDER BY "fetchedAt" DESC LIMIT ${lim}`
  // SQLite 原始整列可能回传 BigInt：统一归一成 number
  return rows.map((r) => ({
    ...r,
    publishedAt: r.publishedAt === null || r.publishedAt === undefined ? null : Number(r.publishedAt),
    fetchedAt: Number(r.fetchedAt),
  }))
}
