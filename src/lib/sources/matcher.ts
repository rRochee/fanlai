// 饭来 · 搜狗微信文章 × 企业匹配 + SourceArticle 入库
// —— 为什么存在：抓取器（./sogou-weixin）只负责把文章池搬回来；本模块做确定性匹配与落库，
//    不走 LLM、不自动建企业（未命中一律 status=new 留待人工，避免脏数据进名录）。
// 匹配策略（按任务约定）：
// · 文章标题+摘要 与 Company.name / fullName 做包含匹配：先精确 name，再 fullName 兜底；
// · 26 届常见互指走小体量 ALIAS 映射（字节跳动/抖音集团、京东/京东集团、腾讯/腾讯科技、
//   阿里/阿里巴巴 等常见互指），别名只作为「文章文本侧」的等价说法，不改动企业名本身；
// · 命中：matchedCompanyId（取首个命中）+ matchedNames（全部命中逗号分隔）+ status=matched；
//   对应 Company 若 verified=false 则转正 verified=true（sourceName 仅在原值为空时写公众号名，
//   不覆盖人工/AI 已填的来源，原值保留不动）。

import { createHash } from "crypto"
import { db } from "@/lib/db"
import { DEFAULT_SOGOU_QUERIES, fetchSogouWeixin, type RawArticle, type SogouQueryReport } from "./sogou-weixin"

/**
 * 常见互指别名（key = 库内企业简称，value = 文章中可能出现等价说法）。
 * 只收高置信互指，宁缺毋滥——别名过宽会把「京东物流」误挂到「京东集团」这类近邻企业上。
 */
const ALIAS_MAP: Record<string, string[]> = {
  字节跳动: ["抖音集团", "字节"],
  阿里巴巴: ["阿里"],
  腾讯: ["腾讯科技"],
  京东: ["京东集团"],
  美团: ["美团点评"],
  网易: ["网易集团"],
  小米集团: ["小米"],
  比亚迪: ["比亚迪股份"],
  宁德时代: ["宁德"],
}

export interface MatchedCompany {
  id: string
  name: string
  verified: boolean
  sourceName: string
}

export interface ArticleMatch {
  companyId: string | null // 首个命中企业 id（未命中为 null）
  matchedNames: string // 全部命中企业名逗号分隔（未命中为空串）
}

interface CompanyRow {
  id: string
  name: string
  fullName: string | null
  verified: boolean
  sourceName: string
}

/** 对单篇文章做企业匹配：第一轮精确 name，第二轮 fullName 兜底，第三轮别名互指 */
export function matchArticleToCompanies(
  title: string,
  summary: string,
  companies: CompanyRow[]
): ArticleMatch {
  const text = `${title} ${summary}`
  const hits: MatchedCompany[] = []
  const pushHit = (c: CompanyRow) => {
    if (hits.some((h) => h.id === c.id)) return
    hits.push({ id: c.id, name: c.name, verified: c.verified, sourceName: c.sourceName })
  }

  // 1) 精确简称包含（≥2 字才参与，防单字误命中）
  for (const c of companies) {
    if (c.name.length >= 2 && text.includes(c.name)) pushHit(c)
  }
  // 2) 全称兜底（≥4 字，防止短全称与简称重复刷屏）
  if (hits.length === 0) {
    for (const c of companies) {
      const fn = (c.fullName ?? "").trim()
      if (fn.length >= 4 && text.includes(fn)) pushHit(c)
    }
  }
  // 3) 别名互指兜底
  if (hits.length === 0) {
    for (const c of companies) {
      const aliases = ALIAS_MAP[c.name] ?? []
      if (aliases.some((a) => a.length >= 2 && text.includes(a))) pushHit(c)
    }
  }

  return {
    companyId: hits[0]?.id ?? null,
    matchedNames: hits
      .slice(0, 5)
      .map((h) => h.name)
      .join(","),
  }
}

export interface IngestResult {
  received: number // 本批文章数
  inserted: number // 新入库数（sogouKey 唯一冲突的跳过）
  matched: number // 本批新命中企业的文章数
  verifiedNow: string[] // 本次由文章命中转正（verified false→true）的企业名
}

/** 文章池入库：sha1(账号名+标题) 去重（INSERT OR IGNORE 语义）+ 命中匹配 + 待核企业转正 */
export async function ingestSourceArticles(articles: RawArticle[]): Promise<IngestResult> {
  const result: IngestResult = { received: articles.length, inserted: 0, matched: 0, verifiedNow: [] }
  if (articles.length === 0) return result

  const companies = (await db.company.findMany({
    select: { id: true, name: true, fullName: true, verified: true, sourceName: true },
  })) as CompanyRow[]

  for (const a of articles) {
    const sogouKey = createHash("sha1").update(`${a.account}|${a.title}`).digest("hex")
    const match = matchArticleToCompanies(a.title, a.summary, companies)
    try {
      await db.sourceArticle.create({
        data: {
          sogouKey,
          title: a.title,
          account: a.account,
          url: a.url,
          publishedAt: a.publishedAt,
          query: a.query,
          matchedCompanyId: match.companyId,
          matchedNames: match.matchedNames || null,
          status: match.companyId ? "matched" : "new",
        },
      })
      result.inserted++
    } catch {
      // sogouKey 唯一冲突 = 已抓过（INSERT OR IGNORE 语义），跳过不中断
      continue
    }
    if (match.companyId) {
      result.matched++
      // 命中转正：verified=false 的企业被公众号文章佐证 → verified=true（sourceName 仅原为空时补写公众号名）
      for (const hitName of match.matchedNames.split(",").filter(Boolean)) {
        const c = companies.find((x) => x.name === hitName)
        if (!c || c.verified) continue
        try {
          await db.company.update({
            where: { id: c.id },
            data: {
              verified: true,
              ...(c.sourceName.trim() ? {} : { sourceName: a.account }),
            },
          })
          c.verified = true // 内存同步置位，避免同轮重复转正
          if (!result.verifiedNow.includes(c.name)) result.verifiedNow.push(c.name)
        } catch {
          // 转正失败不影响文章入库
        }
      }
    }
  }
  return result
}

// ─────────────────────────── 情报采集（抓取 + 入库编排，防重入） ───────────────────────────

export interface HarvestResult {
  ran: boolean // false = 已有一轮在跑，防重入跳过
  okQueries: number
  totalQueries: number
  blockedQueries: number
  fetched: number // 抓到（组内去重后）
  inserted: number // 新入库
  matched: number // 命中企业的新文章数
  verifiedNow: string[]
  queryReports: SogouQueryReport[]
  note: string // 人话摘要，供同步日志/面板引用
}

interface HarvestState {
  running: boolean
}
const g = globalThis as unknown as { __fanlaiSourceHarvest?: HarvestState }
function state(): HarvestState {
  if (!g.__fanlaiSourceHarvest) g.__fanlaiSourceHarvest = { running: false }
  return g.__fanlaiSourceHarvest
}

/**
 * 跑一轮「搜狗微信直搜 → 匹配 → 入库」。串行安全：模块级 running flag 防重入，
 * 已在跑时直接返回 ran=false（调用方照常继续，绝不阻塞主同步）。
 * 任何异常都被吞掉并转为 note（抓取失败绝不向上抛——主同步不受牵连）。
 */
export async function runSourceArticleHarvest(source: "auto" | "manual" = "manual"): Promise<HarvestResult> {
  const s = state()
  if (s.running) {
    return { ran: false, okQueries: 0, totalQueries: 0, blockedQueries: 0, fetched: 0, inserted: 0, matched: 0, verifiedNow: [], queryReports: [], note: "搜狗微信直搜上一轮仍在运行，本轮跳过" }
  }
  s.running = true
  try {
    const reports: SogouQueryReport[] = []
    const articles = await fetchSogouWeixin(DEFAULT_SOGOU_QUERIES, {
      onQueryDone: (r) => reports.push(r),
    })
    const ingest = await ingestSourceArticles(articles)
    const okQueries = reports.filter((r) => r.ok).length
    const blockedQueries = reports.filter((r) => r.blocked).length
    const parts: string[] = [`成功 ${okQueries}/${reports.length || DEFAULT_SOGOU_QUERIES.length} 组关键词`]
    if (blockedQueries > 0) parts.push(`${blockedQueries} 组被搜狗反爬拦截`)
    parts.push(`抓到 ${ingest.received} 篇 · 新入库 ${ingest.inserted} 篇 · 命中企业 ${ingest.matched} 篇`)
    if (ingest.verifiedNow.length > 0) parts.push(`转正待核企业：${ingest.verifiedNow.join("、")}`)
    return {
      ran: true,
      okQueries,
      totalQueries: reports.length,
      blockedQueries,
      fetched: ingest.received,
      inserted: ingest.inserted,
      matched: ingest.matched,
      verifiedNow: ingest.verifiedNow,
      queryReports: reports,
      note: `搜狗微信直搜（${source}）：${parts.join(" · ")}`,
    }
  } catch (e) {
    // 兜底：任何异常都不向上抛，只记日志与 note——抓取失败绝不阻塞主同步
    const msg = (e as Error).message?.slice(0, 100) ?? "未知错误"
    console.warn(`[sogou-weixin] 情报采集轮失败：${msg}`)
    return {
      ran: true,
      okQueries: 0,
      totalQueries: 0,
      blockedQueries: 0,
      fetched: 0,
      inserted: 0,
      matched: 0,
      verifiedNow: [],
      queryReports: [],
      note: `搜狗微信直搜失败（不阻塞主同步）：${msg}`,
    }
  } finally {
    s.running = false
  }
}
