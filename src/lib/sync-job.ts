// 饭来 · 情报同步任务管理器
// —— 为什么存在：同步是长耗时操作（串行 7 组检索 + LLM 提炼，常见 30~90s），
//    原先在 HTTP 请求里同步执行，网关在长请求上会 502 断开，用户端表现为「更新失败」。
//    现在改为「立即受理 + 后台执行 + 轮询取结果」：POST /api/refresh 立即返回 202，
//    结果落库并通过 GET /api/sync-status 暴露。
// job 状态挂在 globalThis 上：dev 模式模块重载 / 多路由引用共享同一份运行状态。

import ZAI from "z-ai-web-dev-sdk"
import { db } from "@/lib/db"
import { shanghaiToday, parseDateStr, daysUntil } from "@/lib/date"
import { parseJsonArrayLoose } from "./audit-job"
import { runSourceArticleHarvest } from "./sources/matcher"

export interface SearchItem {
  url: string
  name: string
  snippet: string
  host_name: string
  date: string
}

export interface ExtractedCompany {
  name: string
  industry?: string
  city?: string
  summary?: string
  positions?: string[]
  sourceName?: string
  publishedDay?: string | null
  recruitUrl?: string
}

export interface QueryReport {
  q: string
  ok: boolean
  hits: number
  attempts: number
  error?: string
}

export interface SyncJobResult {
  added: number
  refreshed: number
  skipped: number
  items: string[]
  refreshedItems: string[]
  searched: number
  failedQueries: number
  message: string
}

export interface SyncJobSnapshot {
  running: boolean
  season: string
  source: "auto" | "manual"
  startedAt: number
  finishedAt: number | null
  elapsedMs: number
  /** 当前阶段描述（如「搜狗微信情报抓取中…」），随 sync-status 轮询透出 */
  phase: string | null
  result: SyncJobResult | null
  error: string | null
}

interface SyncJobState {
  running: boolean
  season: string
  source: "auto" | "manual"
  startedAt: number
  finishedAt: number | null
  phase: string | null
  result: SyncJobResult | null
  error: string | null
}

export const QUERIES: Record<string, { q: string; days: number }[]> = {
  秋招: [
    { q: "2027届 秋季校园招聘 启动", days: 3 },
    { q: "秋招 管培生 网申 开启", days: 3 },
    { q: "2027 校园招聘 全球启动 公告", days: 5 },
    { q: "秋招 提前批 正式批 开启 应届生", days: 3 },
    { q: "2027届 校招 宣讲会 启动", days: 5 },
    { q: "名企 校园招聘 官网 网申 入口 2027", days: 5 },
    // 渠道定向：实习僧 / BOSS直聘 / 应届生求职网（用户指定必覆盖渠道）
    { q: "实习僧 2027届 秋招 校园招聘 启动", days: 3 },
    { q: "BOSS直聘 2027 秋招 校园招聘 开启", days: 3 },
    { q: "应届生求职网 YingJieSheng 2027届 秋季校招", days: 5 },
    // 渠道定向：微信公众号 / 服务号（搜狗微信收录的 mp 推文）
    { q: "mp.weixin.qq.com 秋招 启动 2027届", days: 3 },
    { q: "微信公众号 招聘 推文 秋招 网申 2027", days: 3 },
    { q: "秋招 启动 企业 公众号 推送", days: 3 },
  ],
  春招: [
    { q: "2027届 春季校园招聘 启动", days: 3 },
    { q: "春招 管培生 网申 开启", days: 3 },
    { q: "2027 春季招聘 补录 公告", days: 5 },
    { q: "春招 提前批 开启 应届生", days: 3 },
    { q: "2027届 春招 宣讲会 启动", days: 5 },
    { q: "名企 春季校招 官网 网申 入口", days: 5 },
    // 渠道定向：实习僧 / BOSS直聘 / 应届生求职网
    { q: "实习僧 2027届 春招 校园招聘 启动", days: 3 },
    { q: "BOSS直聘 2027 春招 校园招聘 开启", days: 3 },
    { q: "应届生求职网 YingJieSheng 2027届 春季校招", days: 5 },
    // 渠道定向：微信公众号 / 服务号
    { q: "mp.weixin.qq.com 春招 启动 2027届", days: 3 },
    { q: "微信公众号 招聘 推文 春招 网申 2027", days: 3 },
    { q: "春招 启动 企业 公众号 推送", days: 3 },
  ],
  社招: [
    { q: "社会招聘 启动 热招", days: 3 },
    { q: "社招 岗位 发布 校企", days: 3 },
    { q: "公司 官网 招聘 更新 岗位", days: 5 },
    { q: "社会招聘 名企 开放 应聘", days: 5 },
    { q: "招聘 启事 发布 知名企业", days: 5 },
    { q: "名企 社招 官网 投递 入口", days: 5 },
    // 渠道定向：实习僧 / BOSS直聘 / 应届生求职网
    { q: "实习僧 社招 名企 招聘 启动", days: 3 },
    { q: "BOSS直聘 社会招聘 名企 热招", days: 3 },
    { q: "应届生求职网 社会招聘 发布", days: 5 },
    // 渠道定向：微信公众号 / 服务号
    { q: "mp.weixin.qq.com 社会招聘 启动", days: 3 },
    { q: "微信公众号 招聘 推文 社招 投递", days: 3 },
    { q: "社会招聘 公众号 推送 启事", days: 3 },
  ],
}

const SEASON_KEYWORD: Record<string, string> = {
  秋招: "秋招",
  春招: "春招",
  社招: "社会招聘",
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 单条查询串行执行 + 429 退避重试（2.5s / 6s + 随机抖动），每次尝试都写入报告 */
export async function searchWithRetry(
  zai: Awaited<ReturnType<typeof ZAI.create>>,
  q: string,
  days: number,
  report: QueryReport[]
): Promise<SearchItem[]> {
  const backoffs = [0, 2500, 6000]
  let lastError = ""
  for (let attempt = 0; attempt < backoffs.length; attempt++) {
    if (backoffs[attempt] > 0) {
      await sleep(backoffs[attempt] + Math.floor(Math.random() * 900))
    }
    try {
      const res = await zai.functions.invoke("web_search", { query: q, num: 10, recency_days: days })
      const items = Array.isArray(res) ? (res as SearchItem[]) : []
      report.push({ q, ok: true, hits: items.length, attempts: attempt + 1 })
      return items
    } catch (e) {
      lastError = (e as Error).message.slice(0, 80)
    }
  }
  report.push({ q, ok: false, hits: 0, attempts: backoffs.length, error: lastError })
  return []
}

// 城市归一化：LLM 输出「未知/未注明/unknown」等无效地名统一落为「待核」
export function normalizeCity(raw?: string): string {
  const v = (raw ?? "").trim().slice(0, 20)
  if (!v || ["未知", "未注明", "不详", "无", "待定", "unknown", "none", "n/a", "-"].includes(v.toLowerCase()))
    return "待核"
  return v
}

export const KNOWN_INDUSTRY = [
  "科技零售",
  "智能制造",
  "消费电子",
  "智能硬件",
  "供应链与物流",
  "进出口贸易",
  "医疗健康",
  "实业与新能源",
  "互联网与软件",
  "汽车与出行",
  "消费品与快消",
  "金融与银行",
  "教育与培训",
  "文化与传媒",
  "法律与专业服务",
  "地产与建筑",
  "国企与公用事业",
  "酒旅与航空",
]

/** 旧闻守卫：动态日期早于 N 天前视为旧闻，直接丢弃 */
const STALE_DAYS = 14

/** 当前招聘季对应的应届届别（校招季 7 月起算下一届；社招 null） */
function expectedCohort(season: string, todayStr: string): number | null {
  if (season === "社招") return null
  const y = parseInt(todayStr.slice(0, 4), 10)
  const m = parseInt(todayStr.slice(5, 7), 10)
  return m >= 7 ? y + 1 : y
}

/** 同一进程内共享的 job 状态（防 dev 模块重载丢状态） */
const g = globalThis as unknown as { __fanlaiSyncJob?: SyncJobState }

function state(): SyncJobState {
  if (!g.__fanlaiSyncJob) {
    g.__fanlaiSyncJob = {
      running: false,
      season: "",
      source: "manual",
      startedAt: 0,
      finishedAt: null,
      phase: null,
      result: null,
      error: null,
    }
  }
  return g.__fanlaiSyncJob
}

/** 汇报当前阶段（供 sync-status 轮询透出，如「搜狗微信情报抓取中…」） */
function setPhase(phase: string | null): void {
  state().phase = phase
}

export function isSyncRunning(): boolean {
  return state().running
}

export function getSyncJob(): SyncJobSnapshot {
  const s = state()
  return {
    running: s.running,
    season: s.season,
    source: s.source,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    elapsedMs: s.running ? Date.now() - s.startedAt : s.finishedAt ? s.finishedAt - s.startedAt : 0,
    phase: s.phase,
    result: s.result,
    error: s.error,
  }
}

/** 启动一轮同步（fire-and-forget）。返回 started=false 表示已有一轮在跑 */
export function startSyncJob(season: string, source: "auto" | "manual"): { started: boolean } {
  const s = state()
  if (s.running) return { started: false }
  s.running = true
  s.season = season
  s.source = source
  s.startedAt = Date.now()
  s.finishedAt = null
  s.phase = null
  s.result = null
  s.error = null
  // 后台执行：不 await，让 HTTP 请求立即返回；完成态写入共享状态 + 数据库
  void runSyncJob(season, source).catch((e) => {
    s.running = false
    s.finishedAt = Date.now()
    s.phase = null
    s.error = (e as Error).message.slice(0, 160)
  })
  return { started: true }
}

async function runSyncJob(season: string, source: "auto" | "manual"): Promise<void> {
  const s = state()
  try {
    const result = await executeSync(season, source)
    s.result = result
    s.error = null
  } finally {
    s.running = false
    s.finishedAt = Date.now()
    s.phase = null
  }
}

/** 同步主流程：联网检索 → AI 提炼 → 去重入库 → 搜狗微信直搜补充管道（失败不阻塞） */
async function executeSync(season: string, source: "auto" | "manual"): Promise<SyncJobResult> {
  const result = await executeSyncCore(season, source)

  // 4) 搜狗微信直搜补充情报（SourceArticle 管道）：独立于主检索的第二情报源，
  //    任何失败只记日志与报告，绝不影响主同步结果（runSourceArticleHarvest 内部已兜底不抛）
  let weixinNote = ""
  try {
    setPhase("搜狗微信情报抓取中…")
    const harvest = await runSourceArticleHarvest(source)
    weixinNote = harvest.ran ? harvest.note : "搜狗微信直搜上一轮仍在运行，本轮跳过"
    console.log(`[sync-job] ${weixinNote}`)
  } catch (e) {
    weixinNote = `搜狗微信直搜失败（不阻塞主同步）：${(e as Error).message.slice(0, 80)}`
    console.warn(`[sync-job] ${weixinNote}`)
  }
  if (weixinNote) {
    result.message = result.message ? `${result.message}；${weixinNote}` : weixinNote
    // 公众号直搜结果补记进同步日志（stats / sync-status 均读 lastSyncLog，多余字段向后兼容）
    try {
      const log = JSON.stringify({
        at: new Date().toISOString(),
        added: result.added,
        refreshed: result.refreshed,
        source,
        season,
        weixin: weixinNote,
      })
      await db.setting.upsert({ where: { key: "lastSyncLog" }, create: { key: "lastSyncLog", value: log }, update: { value: log } })
    } catch {}
  }
  return result
}

/** 核心同步：串行检索 → LLM 提炼 → 去重入库 → 报告落库（原 executeSync 主链路） */
async function executeSyncCore(season: string, source: "auto" | "manual"): Promise<SyncJobResult> {
  const queries = QUERIES[season] ?? QUERIES["秋招"]
  const seasonWord = SEASON_KEYWORD[season] ?? "秋招"
  const today = shanghaiToday()
  const zai = await ZAI.create()

  // 1) 串行搜索（含 429 退避重试），每条查询写入执行报告
  setPhase("联网检索中…")
  const queryReports: QueryReport[] = []
  const searchResults: SearchItem[] = []
  const seen = new Set<string>()
  for (const { q, days } of queries) {
    const items = await searchWithRetry(zai, q, days, queryReports)
    for (const item of items) {
      if (!item?.name || seen.has(item.url)) continue
      seen.add(item.url)
      searchResults.push(item)
    }
    await sleep(600) // 串行间隔：给搜索服务留出限流窗口
  }
  const failedQueries = queryReports.filter((r) => !r.ok).length

  if (searchResults.length === 0) {
    // 颗粒无收也落库——「这轮到底搜了没有、有没有失败」必须可追溯
    try {
      await db.setting.upsert({
        where: { key: "lastSyncReport" },
        create: { key: "lastSyncReport", value: JSON.stringify({ at: new Date().toISOString(), season, source, queries: queryReports, searched: 0, added: 0, refreshed: 0, llm: "skipped" }) },
        update: { value: JSON.stringify({ at: new Date().toISOString(), season, source, queries: queryReports, searched: 0, added: 0, refreshed: 0, llm: "skipped" }) },
      })
    } catch {}
    return {
      added: 0,
      refreshed: 0,
      skipped: 0,
      items: [],
      refreshedItems: [],
      searched: 0,
      failedQueries,
      message:
        failedQueries > 0
          ? `本轮 ${failedQueries}/${queryReports.length} 条检索未成功（已自动重试），请稍后再试一次`
          : "本轮未搜索到新情报",
    }
  }

  // 2) LLM 提炼结构化企业情报
  setPhase("AI 提炼中…")
  const corpus = searchResults
    .slice(0, 40)
    .map((r, i) => `${i + 1}. 标题:${r.name} | 摘要:${r.snippet.slice(0, 200)} | 来源:${r.host_name} | 日期:${r.date || "未知"} | 链接:${r.url}`)
    .join("\n")

  const prompt = `以下是联网搜索到的关于中国${seasonWord}的信息片段。今天是 ${today}，面向2027届毕业生。
请从中提取「最近几天内新放出 / 新启动 / 新推送了${seasonWord}信息的企业」。
要求：
- 只提取明确是企业（公司/集团/银行）的条目，忽略中介、就业网、汇总文章本身
- 铁律一（届别）：只有明确服务「2027届 / 2027校招 / 2027年招聘」的信息才有效；标题或摘要中出现「2026届」「2025届」或往届字样的，一律不提取，宁可漏掉不可拿旧闻充数${season === "社招" ? "（社招无届别要求，跳过本条）" : ""}
- 铁律二（时效）：日期早于 ${today} 前第 7 天的旧闻（含往年信息）一律不提取
- 企业名使用中文通用简称（如「联合利华」「安踏集团」）
- industry 必须从以下清单选择最贴近的一项：${KNOWN_INDUSTRY.join("、")}；实在不符可自拟两到四字行业名
- summary 为一句话亮点（20字内）
- positions 为热招方向数组（1-3个，管培生/岗位名）
- sourceName 为信息来源渠道名（如公众号名、招聘平台名、高校就业网）
- publishedDay 从搜索结果的日期推断（格式 YYYY-MM-DD），只能是今天或最近几天；无法确定则为 null
- city 写主要工作/办公城市（如「上海」「深圳/北京」「全国」）；搜索结果无法推断时写「待核」，禁止编造
- recruitUrl 用搜索结果中该企业的官方招聘链接（若为招聘平台/高校转发则保留原链接）
- 严格输出 JSON 数组，不要输出任何其他文字：[{"name":"...","industry":"...","city":"...","summary":"...","positions":["..."],"sourceName":"...","publishedDay":null,"recruitUrl":"..."}]
- 最多提取 12 家，宁缺毋滥

信息片段：
${corpus}`

  let extracted: ExtractedCompany[] = []
  try {
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: "你是严谨的校招情报提炼助手，只输出 JSON。" },
        { role: "user", content: prompt },
      ],
      thinking: { type: "disabled" },
    })
    const raw = completion.choices[0]?.message?.content ?? ""
    extracted = parseJsonArrayLoose(raw) as ExtractedCompany[]
  } catch (e) {
    throw new Error(`情报提炼失败：${(e as Error).message.slice(0, 120)}`)
  }

  if (!Array.isArray(extracted) || extracted.length === 0) {
    const emptyResult: SyncJobResult = {
      added: 0,
      refreshed: 0,
      skipped: 0,
      items: [],
      refreshedItems: [],
      searched: searchResults.length,
      failedQueries,
      message: "本轮未提炼出新的企业情报",
    }
    try {
      await db.setting.upsert({
        where: { key: "lastSyncReport" },
        create: { key: "lastSyncReport", value: JSON.stringify({ at: new Date().toISOString(), season, source, queries: queryReports, searched: searchResults.length, added: 0, refreshed: 0, llm: "empty" }) },
        update: { value: JSON.stringify({ at: new Date().toISOString(), season, source, queries: queryReports, searched: searchResults.length, added: 0, refreshed: 0, llm: "empty" }) },
      })
    } catch {}
    return emptyResult
  }

  // 3) 与库内企业去重后入库
  setPhase("名录比对入库中…")
  const existing = await db.company.findMany({
    select: { id: true, name: true, publishedAt: true, verified: true, season: true },
  })
  const normalize = (n: string) => n.replace(/（.*?）/g, "").replace(/\s/g, "")
  const findExisting = (name: string) => {
    const target = normalize(name)
    return existing.find((e) => {
      const n = normalize(e.name)
      return n.includes(target) || target.includes(n)
    })
  }
  const isStale = (day: string | null | undefined) => {
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
    return daysUntil(parseDateStr(day), today) < -STALE_DAYS + 1
  }
  const cohort = expectedCohort(season, today)
  const staleCohorts = cohort ? Array.from({ length: 3 }, (_, i) => `${cohort - 1 - i}届`) : []
  const hasStaleCohort = (c: ExtractedCompany) => {
    if (staleCohorts.length === 0) return false
    const blob = [c.summary ?? "", (c.positions ?? []).join(","), c.sourceName ?? ""].join(" ")
    return staleCohorts.some((mark) => blob.includes(mark))
  }

  let added = 0
  let refreshed = 0
  let skipped = 0
  const addedItems: string[] = []
  const refreshedItems: string[] = []

  for (const c of extracted.slice(0, 12)) {
    if (!c?.name || !c.name.trim()) continue
    const name = c.name.trim().slice(0, 30)
    if (isStale(c.publishedDay) || hasStaleCohort(c)) {
      skipped++
      continue
    }
    const dup = findExisting(name)
    if (dup) {
      // 同名换批：库内送达批次已在 14 天前，且本轮有同季新动态 → 搬入今日批次
      if (daysUntil(dup.publishedAt, today) <= -STALE_DAYS && dup.season === season) {
        try {
          const dynamicNote = c.publishedDay ? `本次动态日期：${c.publishedDay}。` : ""
          await db.company.update({
            where: { id: dup.id },
            data: {
              publishedAt: parseDateStr(today),
              summary: (c.summary ?? "").slice(0, 40) || undefined,
              sourceName: (c.sourceName ?? "公开网络").slice(0, 40),
              description: `饭来情报通道于 ${today} 检测到该企业新的${seasonWord}动态，已更新送达批次。${dynamicNote}${(c.summary ?? "").slice(0, 80)}`.slice(0, 240),
            },
          })
          refreshed++
          refreshedItems.push(name)
        } catch {
          skipped++
        }
      } else {
        skipped++
      }
      continue
    }
    try {
      const dynamicNote = c.publishedDay ? `（动态日期 ${c.publishedDay}）` : ""
      await db.company.create({
        data: {
          name,
          industry: (c.industry ?? "其他行业").slice(0, 12),
          city: normalizeCity(c.city),
          size: "待核",
          funding: "待核",
          summary: (c.summary ?? "AI 情报，待人工核实").slice(0, 40),
          description: `本条由饭来 AI 情报通道于 ${today} 从公开网络抓取提炼${dynamicNote}，标注为待核状态。摘要：${(c.summary ?? "").slice(0, 80)}。建议访问来源核实后投递。`,
          positions: (c.positions ?? []).slice(0, 4).join(",") || "待核",
          tags: "AI情报",
          recruitUrl: (c.recruitUrl ?? "https://www.nowcoder.com").slice(0, 300),
          sourceType: "情报抓取",
          sourceName: (c.sourceName ?? "公开网络").slice(0, 40),
          publishedAt: parseDateStr(today),
          season,
          verified: false,
        },
      })
      added++
      addedItems.push(name)
    } catch {
      skipped++
    }
  }

  const parts: string[] = []
  if (added > 0) parts.push(`新收录 ${added} 家（待核）：${addedItems.join("、")}`)
  if (refreshed > 0) parts.push(`重新送达 ${refreshed} 家：${refreshedItems.join("、")}`)

  // 同步日志（调度器与手动同步共用）
  try {
    await db.setting.upsert({
      where: { key: "lastSyncLog" },
      create: { key: "lastSyncLog", value: JSON.stringify({ at: new Date().toISOString(), added, refreshed, source, season }) },
      update: { value: JSON.stringify({ at: new Date().toISOString(), added, refreshed, source, season }) },
    })
  } catch {}

  // 同步执行报告（供「数据源与更新」面板展示覆盖率）
  try {
    await db.setting.upsert({
      where: { key: "lastSyncReport" },
      create: { key: "lastSyncReport", value: JSON.stringify({ at: new Date().toISOString(), season, source, queries: queryReports, searched: searchResults.length, added, refreshed, llm: "ok" }) },
      update: { value: JSON.stringify({ at: new Date().toISOString(), season, source, queries: queryReports, searched: searchResults.length, added, refreshed, llm: "ok" }) },
    })
  } catch {}

  return {
    added,
    refreshed,
    skipped,
    items: addedItems,
    refreshedItems,
    searched: searchResults.length,
    failedQueries,
    message: parts.length > 0 ? parts.join("；") : "本轮情报与现有名录重复或为旧闻，未新增",
  }
}
