// 饭来 · 搜狗微信直搜管道（与 sync-job 主同步并行的第二情报管道）
// —— 为什么存在：主同步用通用联网检索「间接」触达公众号推文；本管道用搜狗微信搜索
//    （weixin.sogou.com/weixin?type=2）「直接」检索公众号文章池，标题 / 摘要 / 公众号名 /
//    文章时间一次拿全。用户已授权每天 8:00 / 14:00 / 20:00 各抓一轮（调度见 scheduler.ts）。
// job 模式沿用 sync-job：globalThis 共享状态 + fire-and-forget + getWeixinSyncJob() 快照，
// 受理端点立即返回 202，前端轮询取结果——绝不在 HTTP 请求内同步跑长流程（502 教训）。

import ZAI from "z-ai-web-dev-sdk"
import { db } from "@/lib/db"
import { parseDateStr, shanghaiToday, toShanghaiDateStr } from "@/lib/date"
import { parseJsonArrayLoose } from "./audit-job"
import { KNOWN_INDUSTRY, normalizeCity } from "./sync-job"

export interface SogouArticle {
  title: string
  account: string
  summary: string
  publishedAt: Date
  link: string
}

/** 被搜狗反爬拦截（验证码 / antispider / 极短返回体 / 0 条结果），区别于普通网络失败 */
export class SogouBlockedError extends Error {}

/** 面板「最近抓到的文章」条目（link 为搜狗完整跳转链，带 token 有时效，仅供近期查看） */
export interface WeixinArticleBrief {
  title: string
  account: string
  link: string
  publishedAt: string // ISO
}

export interface WeixinSyncResult {
  /** 本轮新抓到（组内去重 + 当天未见）的文章数 */
  articlesFound: number
  /** 新入库企业数 */
  candidatesAdded: number
  addedItems: string[]
  /** 每组关键词的失败原因（限流 / 网络失败），如实记录 */
  errors: string[]
  message: string
  recentArticles: WeixinArticleBrief[]
}

export interface WeixinJobSnapshot {
  running: boolean
  source: "auto" | "manual"
  startedAt: number
  finishedAt: number | null
  elapsedMs: number
  result: WeixinSyncResult | null
  error: string | null
}

/** 落库 Setting(lastWeixinReport) 的报告，面板展示 + 重启不丢 */
export interface WeixinLastReport {
  at: string
  source: "auto" | "manual"
  articlesFound: number
  candidatesAdded: number
  addedItems: string[]
  errors: string[]
  message: string
  recentArticles: WeixinArticleBrief[]
}

const SOGOU_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
const FETCH_TIMEOUT_MS = 15_000
const SOGOU_ORIGIN = "https://weixin.sogou.com"

/** 直搜关键词组（每组一次检索，串行 + 组间随机间隔防限流） */
export const WEIXIN_QUERIES: string[] = [
  "2027届 秋招 校园招聘 启动",
  "秋招 网申 开始 校招",
  "2027届校招 报名 官网",
  "校园招聘 秋招 提前批 开启",
  "秋招 启动 应届生 招聘",
]

const SEEN_KEY = "weixinSeenTitles"
const SEEN_MAX = 500
const REPORT_KEY = "lastWeixinReport"

/** 旧闻守卫：文章发布时间早于 N 天前的不进 LLM（搜狗按相关度排序，会混入旧文） */
const STALE_ARTICLE_DAYS = 30
const CORPUS_MAX = 30
const CANDIDATE_MAX = 12

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ─────────────────────────── 抓取与解析 ───────────────────────────

/** 剥 <em> 高亮、<!-- 注释 --> 与标签，并解码常见 HTML 实体 */
function stripTags(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
}

function absoluteLink(href: string): string {
  // href 原样来自 HTML 属性，实体需还原（否则 &amp;type=... 会让 token 参数名变成 amp;token，跳转失效）
  const h = href.replace(/&amp;/gi, "&").trim()
  if (h.startsWith("//")) return `https:${h}`
  if (h.startsWith("/")) return `${SOGOU_ORIGIN}${h}`
  return h
}

/** 单条结果块解析：标题 / 公众号名 / 摘要 / 时间戳 / 完整跳转链接 */
function parseResultChunk(chunk: string): SogouArticle | null {
  const anchor = chunk.match(/<a\s[^>]*uigs="article_title_\d+"[^>]*>([\s\S]*?)<\/a>/i)
  if (!anchor) return null
  const title = stripTags(anchor[1])
  const href = anchor[0].match(/href="([^"]*)"/i)?.[1] ?? ""
  if (!title || !href) return null
  const account = stripTags(chunk.match(/<span class="all-time-y2"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "")
  const summary = stripTags(chunk.match(/<p class="txt-info"[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "")
  // timeConvert('1788315501') 为 unix 秒（文章大致发布时间）
  const ts = chunk.match(/timeConvert\('(\d+)'\)/)?.[1]
  const publishedAt = ts ? new Date(parseInt(ts, 10) * 1000) : new Date()
  return {
    title: title.slice(0, 120),
    account: (account || "未知公众号").slice(0, 40),
    summary: summary.slice(0, 300),
    publishedAt,
    link: absoluteLink(href).slice(0, 500),
  }
}

function parseSogouHtml(html: string): SogouArticle[] {
  // 每条结果的标题都包在唯一 <h3> 里：按 <h3> 切块逐条提取，不依赖成对 div（避免嵌套误切）
  return html
    .split(/<h3[\s>]/i)
    .slice(1)
    .map((chunk) => parseResultChunk(chunk))
    .filter((a): a is SogouArticle => a !== null)
}

/**
 * 拉取一页搜狗微信文章（type=2 文章搜索）。
 * 被限流抛 SogouBlockedError；网络失败 / 非 200 抛普通 Error。
 */
export async function fetchSogouWeixinArticles(query: string, page = 1): Promise<SogouArticle[]> {
  const url = `${SOGOU_ORIGIN}/weixin?type=2&query=${encodeURIComponent(query)}${page > 1 ? `&page=${page}` : ""}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  let html: string
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": SOGOU_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
      },
      signal: ctrl.signal,
      cache: "no-store",
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    html = await res.text()
  } catch (e) {
    const err = e as Error
    const msg = err.name === "AbortError" ? "请求超时（15s）" : err.message.slice(0, 80)
    throw new Error(`搜狗微信请求失败：${msg}`)
  } finally {
    clearTimeout(timer)
  }

  // 反爬信号：返回体极短 / 含 antispider / seccode / 验证码，或解析出 0 条——一律视为被限流
  const looksBlocked = html.length < 2000 || /antispider|seccode|验证码/i.test(html)
  const articles = looksBlocked ? [] : parseSogouHtml(html)
  if (looksBlocked || articles.length === 0) {
    throw new SogouBlockedError(`返回 ${html.length} 字节，解析 ${articles.length} 条`)
  }
  return articles
}

// ─────────────────────────── job 状态（globalThis，防 dev 模块重载丢状态） ───────────────────────────

interface WeixinJobState {
  running: boolean
  source: "auto" | "manual"
  startedAt: number
  finishedAt: number | null
  result: WeixinSyncResult | null
  error: string | null
}

const g = globalThis as unknown as { __fanlaiWeixinJob?: WeixinJobState }

function state(): WeixinJobState {
  if (!g.__fanlaiWeixinJob) {
    g.__fanlaiWeixinJob = {
      running: false,
      source: "manual",
      startedAt: 0,
      finishedAt: null,
      result: null,
      error: null,
    }
  }
  return g.__fanlaiWeixinJob
}

export function isWeixinSyncRunning(): boolean {
  return state().running
}

export function getWeixinSyncJob(): WeixinJobSnapshot {
  const s = state()
  return {
    running: s.running,
    source: s.source,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    elapsedMs: s.running ? Date.now() - s.startedAt : s.finishedAt ? s.finishedAt - s.startedAt : 0,
    result: s.result,
    error: s.error,
  }
}

/** 启动一轮微信直搜（fire-and-forget，立即返回）。返回 started=false 表示已有一轮在跑 */
export function runWeixinSyncJob(source: "auto" | "manual" = "manual"): { started: boolean } {
  const s = state()
  if (s.running) return { started: false }
  s.running = true
  s.source = source
  s.startedAt = Date.now()
  s.finishedAt = null
  s.result = null
  s.error = null
  void executeWeixinSync(source)
    .then((result) => {
      s.result = result
      s.error = null
    })
    .catch((e) => {
      s.error = (e as Error).message.slice(0, 160)
    })
    .finally(() => {
      s.running = false
      s.finishedAt = Date.now()
    })
  return { started: true }
}

// ─────────────────────────── Setting 持久化（当天已抓标题 / 最近报告） ───────────────────────────

/** 当天已抓过的标题集合（weixinSeenTitles：JSON 数组 [{d,t}]，保留最近 500 条，按日期自然过期） */
async function loadSeenToday(today: string): Promise<Set<string>> {
  try {
    const row = await db.setting.findUnique({ where: { key: SEEN_KEY } })
    if (!row?.value) return new Set()
    const parsed: unknown = JSON.parse(row.value)
    if (!Array.isArray(parsed)) return new Set()
    const titles = new Set<string>()
    for (const entry of parsed) {
      if (entry && typeof entry === "object" && (entry as { d?: unknown }).d === today) {
        const t = (entry as { t?: unknown }).t
        if (typeof t === "string") titles.add(t)
      }
    }
    return titles
  } catch {
    return new Set()
  }
}

async function appendSeenTitles(titles: string[], today: string): Promise<void> {
  if (titles.length === 0) return
  try {
    const row = await db.setting.findUnique({ where: { key: SEEN_KEY } })
    let list: { d: string; t: string }[] = []
    if (row?.value) {
      const parsed: unknown = JSON.parse(row.value)
      if (Array.isArray(parsed)) {
        list = parsed
          .filter(
            (e): e is { d: string; t: string } =>
              !!e &&
              typeof e === "object" &&
              typeof (e as { d?: unknown }).d === "string" &&
              typeof (e as { t?: unknown }).t === "string"
          )
          .map((e) => ({ d: e.d, t: e.t }))
      }
    }
    const merged = [...list, ...titles.map((t) => ({ d: today, t }))].slice(-SEEN_MAX)
    const value = JSON.stringify(merged)
    await db.setting.upsert({ where: { key: SEEN_KEY }, create: { key: SEEN_KEY, value }, update: { value } })
  } catch {
    // 去重集合写失败不影响主流程（最坏情况：同批文章下次多提炼一遍，库内去重兜底）
  }
}

async function persistLastReport(report: WeixinLastReport): Promise<void> {
  try {
    const value = JSON.stringify(report)
    await db.setting.upsert({ where: { key: REPORT_KEY }, create: { key: REPORT_KEY, value }, update: { value } })
  } catch {
    // 报告落库失败不改变 job 结果（前端仍可从 job 快照拿到本轮结果）
  }
}

async function loadLastReport(): Promise<WeixinLastReport | null> {
  try {
    const row = await db.setting.findUnique({ where: { key: REPORT_KEY } })
    if (!row?.value) return null
    return JSON.parse(row.value) as WeixinLastReport
  } catch {
    return null
  }
}

// ─────────────────────────── 候选 URL 可信度 ───────────────────────────

/** 搜索引擎 / 搜狗自身的链接不可作为企业招聘官网 */
const UNTRUSTED_HOSTS = ["weixin.sogou.com", "sogou.com", "sogoucdn.com", "baidu.com", "bing.com", "google.com", "so.com"]

function trustedRecruitUrl(raw: string | undefined): string | null {
  const u = (raw ?? "").trim()
  if (!/^https?:\/\//i.test(u)) return null
  try {
    const host = new URL(u).hostname.toLowerCase()
    if (UNTRUSTED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return null
    return u.slice(0, 300)
  } catch {
    return null
  }
}

const bingSearchUrl = (name: string) =>
  `https://www.bing.com/search?q=${encodeURIComponent(`${name} 校园招聘 官网 网申`)}`

// ─────────────────────────── LLM 提炼 ───────────────────────────

interface WeixinCandidate {
  name?: string
  industry?: string
  city?: string
  summary?: string
  positions?: string[]
  sourceIndex?: number
  recruitUrl?: string
}

// ─────────────────────────── 直搜主流程 ───────────────────────────

async function executeWeixinSync(source: "auto" | "manual"): Promise<WeixinSyncResult> {
  const today = shanghaiToday()
  const errors: string[] = []

  // 1) 串行跑关键词组，组间随机间隔 3~5s 防限流；单组失败记录后继续（不让一组拖死整轮）
  const collected: SogouArticle[] = []
  const seenInRun = new Set<string>()
  for (let i = 0; i < WEIXIN_QUERIES.length; i++) {
    const q = WEIXIN_QUERIES[i]
    if (i > 0) await sleep(3000 + Math.floor(Math.random() * 2000))
    try {
      const arts = await fetchSogouWeixinArticles(q)
      for (const a of arts) {
        const k = `${a.title}|${a.account}`
        if (seenInRun.has(k)) continue
        seenInRun.add(k)
        collected.push(a)
      }
    } catch (e) {
      const msg =
        e instanceof SogouBlockedError
          ? `「${q}」被搜狗限流（${(e as Error).message.slice(0, 60)}）`
          : `「${q}」抓取失败：${(e as Error).message.slice(0, 80)}`
      errors.push(msg)
    }
  }

  // 2) 当天已抓过的标题跳过（集合落 Setting，进程重启不丢）
  const seenToday = await loadSeenToday(today)
  const fresh = collected.filter((a) => !seenToday.has(a.title))

  const buildResult = (over: Partial<WeixinSyncResult>): WeixinSyncResult => ({
    articlesFound: fresh.length,
    candidatesAdded: 0,
    addedItems: [],
    errors,
    message: "",
    recentArticles: [],
    ...over,
  })

  if (fresh.length === 0) {
    const allBlocked = collected.length === 0 && errors.length >= WEIXIN_QUERIES.length
    const message = allBlocked
      ? `本轮 ${errors.length}/${WEIXIN_QUERIES.length} 组关键词被搜狗限流，未抓到文章；下个时段自动重试`
      : collected.length === 0
        ? `本轮未抓到文章（${errors.length} 组关键词失败）`
        : `本轮抓到 ${collected.length} 篇文章，均为当天已抓过的内容，未新增`
    // 本轮没有新文章时沿用上轮的文章列表（「最近抓到的文章」看的是近期成果，不是本轮增量）
    const prev = await loadLastReport()
    const result = buildResult({ message, articlesFound: 0, recentArticles: prev?.recentArticles ?? [] })
    await persistLastReport({ at: new Date().toISOString(), source, ...result })
    return result
  }

  // 3) 旧闻守卫：超过 30 天的旧文不进提炼（标题仍计入当天已抓，明天不再重复扫）
  const cutoff = Date.now() - STALE_ARTICLE_DAYS * 86_400_000
  const current = fresh.filter((a) => a.publishedAt.getTime() >= cutoff)
  const recentArticles: WeixinArticleBrief[] = current
    .slice(0, 5)
    .map((a) => ({ title: a.title, account: a.account, link: a.link, publishedAt: a.publishedAt.toISOString() }))

  if (current.length === 0) {
    const prev = await loadLastReport()
    const result = buildResult({
      message: `本轮新抓 ${fresh.length} 篇文章均为 ${STALE_ARTICLE_DAYS} 天前旧文，未进入提炼`,
      recentArticles: prev?.recentArticles ?? [],
    })
    await appendSeenTitles(fresh.map((a) => a.title), today)
    await persistLastReport({ at: new Date().toISOString(), source, ...result })
    return result
  }

  // 4) LLM 提炼企业候选（调用方式与宽松解析同 sync-job）
  const corpusArticles = current.slice(0, CORPUS_MAX)
  const corpusText = corpusArticles
    .map(
      (a, i) =>
        `${i + 1}. 标题:${a.title} | 公众号:${a.account} | 发布日期:${toShanghaiDateStr(a.publishedAt)} | 摘要:${a.summary.slice(0, 160)}`
    )
    .join("\n")

  const prompt = `以下是通过搜狗微信搜索抓到的微信公众号文章（关于中国秋招/校园招聘）。今天是 ${today}，面向2027届毕业生。
请从中提取「最近新放出 / 新启动了秋招或校园招聘信息的企业」。
要求：
- 只提取明确是企业（公司/集团/银行）的条目；求职中介、就业信息网、汇总类公众号本身不算企业，但其文章中提到的具体企业可以提取
- 铁律一（届别）：只有明确面向「2027届 / 2027校招 / 2027年招聘」的信息才有效；明确写「2026届」「2025届」或往届字样的一律不提取，宁可漏掉不可拿旧闻充数
- 铁律二（时效）：文章发布日期早于 ${today} 前 14 天的，其中的信息一律不提取
- 企业名使用中文通用简称（如「联合利华」「安踏集团」）
- industry 必须从以下清单选择最贴近的一项：${KNOWN_INDUSTRY.join("、")}；实在不符可自拟两到四字行业名
- summary 为一句话亮点（20字内）
- positions 为热招方向数组（1-3个，管培生/岗位名）
- city 写主要工作/办公城市（如「上海」「深圳/北京」「全国」）；无法推断时写「待核」，禁止编造
- sourceIndex 必填：该企业信息来自第几篇文章（对应下列条目序号，从 1 开始）
- recruitUrl 仅当摘要中出现明确的官方招聘网址/官网域名时填写，否则留空字符串；禁止编造网址
- 严格输出 JSON 数组，不要输出任何其他文字，字段值内禁止英文双引号：[{"name":"...","industry":"...","city":"...","summary":"...","positions":["..."],"sourceIndex":1,"recruitUrl":""}]
- 最多提取 ${CANDIDATE_MAX} 家，宁缺毋滥

文章列表：
${corpusText}`

  let extracted: WeixinCandidate[] = []
  try {
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: "你是严谨的校招情报提炼助手，只输出 JSON。" },
        { role: "user", content: prompt },
      ],
      thinking: { type: "disabled" },
    })
    const raw = completion.choices[0]?.message?.content ?? ""
    extracted = parseJsonArrayLoose(raw) as WeixinCandidate[]
  } catch (e) {
    // 提炼失败抛错：标题不标记已抓（下个时段原样重试），失败原因进 job.error
    throw new Error(`公众号情报提炼失败：${(e as Error).message.slice(0, 120)}`)
  }

  // 5) 与库内现有企业做名字模糊互含排除后入库（规则同 sync-job）
  const existing = await db.company.findMany({ select: { name: true } })
  const normalize = (n: string) => n.replace(/（.*?）/g, "").replace(/\s/g, "")
  const knownNames = existing.map((e) => normalize(e.name)).filter(Boolean)

  let candidatesAdded = 0
  const addedItems: string[] = []
  const usedInRun = new Set<string>()

  for (const c of extracted.slice(0, CANDIDATE_MAX)) {
    const name = (c?.name ?? "").trim().slice(0, 30)
    if (!name) continue
    const target = normalize(name)
    if (!target || usedInRun.has(target)) continue
    if (knownNames.some((n) => n.includes(target) || target.includes(n))) continue
    usedInRun.add(target)

    // 候选回溯源文章：拿公众号名与文章时间（publishedAt=文章时间）
    const idx = typeof c.sourceIndex === "number" ? Math.round(c.sourceIndex) : Number.NaN
    const src = Number.isInteger(idx) && idx >= 1 && idx <= corpusArticles.length ? corpusArticles[idx - 1] : null
    const recruitUrl = trustedRecruitUrl(c.recruitUrl) ?? ""

    try {
      await db.company.create({
        data: {
          name,
          industry: (c.industry ?? "其他行业").slice(0, 12),
          city: normalizeCity(c.city),
          size: "待核",
          funding: "待核",
          summary: (c.summary ?? "公众号情报，待人工核实").slice(0, 40),
          description: `本条由饭来公众号直搜通道于 ${today} 从搜狗微信收录的公众号文章提炼（来源公众号：${src?.account ?? "微信公众号"}），标注为待核状态。摘要：${(c.summary ?? "").slice(0, 80)}。建议访问来源核实后投递。`,
          positions: (c.positions ?? []).slice(0, 4).join(",") || "待核",
          tags: "公众号情报",
          recruitUrl,
          sourceType: "公众号",
          sourceName: (src?.account ?? "微信公众号").slice(0, 40),
          publishedAt: src ? src.publishedAt : parseDateStr(today),
          season: "秋招",
          verified: false,
        },
      })
      candidatesAdded++
      addedItems.push(name)
    } catch {
      // 唯一名冲突等入库失败：跳过该候选，不中断整轮
    }
  }

  // 6) 处理成功后才标记标题已抓（LLM 失败时下个时段可原样重试）；最近报告落库供面板展示
  await appendSeenTitles(fresh.map((a) => a.title), today)
  const message =
    candidatesAdded > 0
      ? `新收录 ${candidatesAdded} 家（待核）：${addedItems.join("、")}`
      : extracted.length > 0
        ? "本轮公众号文章与现有名录重复或为旧闻，未新增"
        : "本轮未从公众号文章中提炼出新的企业情报"
  const result = buildResult({ candidatesAdded, addedItems, message, recentArticles })
  await persistLastReport({ at: new Date().toISOString(), source, ...result })
  return result
}
