// 饭来 · 查漏体检任务管理器
// —— 回答「如何确认没有遗漏」：常规同步用「事件关键词」检索（XX 启动 / 网申开启），
//    查漏体检改用「主体维度」检索——把用户的优先赛道逐个行业搜一遍 + 主流渠道扫一遍，
//    再由 AI 提炼出「库里还没有的企业」候选清单，交给用户裁决。
//    两套检索式互不重叠，形成交叉验证；候选只报告、不直接入库。

import ZAI from "z-ai-web-dev-sdk"
import { db } from "@/lib/db"
import { shanghaiToday } from "@/lib/date"
import { KNOWN_INDUSTRY, normalizeCity, searchWithRetry, type QueryReport } from "./sync-job"

export interface AuditCandidate {
  name: string
  industry?: string
  city?: string
  summary?: string
  positions?: string[]
  sourceName?: string
  publishedDay?: string | null
  recruitUrl?: string
  evidence?: string // 检索证据：命中的标题/来源，供用户核实
}

export interface AuditJobResult {
  candidates: AuditCandidate[]
  searched: number
  failedQueries: number
  message: string
}

export interface AuditJobSnapshot {
  running: boolean
  season: string
  startedAt: number
  finishedAt: number | null
  elapsedMs: number
  result: AuditJobResult | null
  error: string | null
}

interface AuditJobState {
  running: boolean
  season: string
  startedAt: number
  finishedAt: number | null
  result: AuditJobResult | null
  error: string | null
}

const g = globalThis as unknown as { __fanlaiAuditJob?: AuditJobState }

function state(): AuditJobState {
  if (!g.__fanlaiAuditJob) {
    g.__fanlaiAuditJob = { running: false, season: "", startedAt: 0, finishedAt: null, result: null, error: null }
  }
  return g.__fanlaiAuditJob
}

export function isAuditRunning(): boolean {
  return state().running
}

export function getAuditJob(): AuditJobSnapshot {
  const s = state()
  return {
    running: s.running,
    season: s.season,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    elapsedMs: s.running ? Date.now() - s.startedAt : s.finishedAt ? s.finishedAt - s.startedAt : 0,
    result: s.result,
    error: s.error,
  }
}

export function startAuditJob(season: string): { started: boolean } {
  const s = state()
  if (s.running) return { started: false }
  s.running = true
  s.season = season
  s.startedAt = Date.now()
  s.finishedAt = null
  s.result = null
  s.error = null
  void runAuditJob(season).catch((e) => {
    s.running = false
    s.finishedAt = Date.now()
    s.error = (e as Error).message.slice(0, 160)
  })
  return { started: true }
}

async function runAuditJob(season: string): Promise<void> {
  const s = state()
  try {
    const result = await executeAudit(season)
    s.result = result
    s.error = null
  } finally {
    s.running = false
    s.finishedAt = Date.now()
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 宽松解析 LLM 输出的 JSON 数组：
 * 先尝试整段解析；失败则逐对象提取（对未转义引号/局部截断容错），
 * 能解析多少条算多少条——查漏场景宁多勿漏，个别脏条目丢弃可接受。
 */
export function parseJsonArrayLoose(raw: string): unknown[] {
  const out: unknown[] = []
  const m = raw.match(/\[[\s\S]*\]/)
  if (m) {
    try {
      const arr = JSON.parse(m[0])
      if (Array.isArray(arr)) return arr
    } catch {}
  }
  const objs = raw.match(/\{[^{}]*\}/g) ?? []
  for (const o of objs) {
    try {
      out.push(JSON.parse(o))
    } catch {}
  }
  return out
}

/** 查漏体检专属检索式：主体维度（逐行业）+ 渠道维度，与常规同步的事件维度不重叠 */
const AUDIT_SEEDS: { dim: string; items: { q: string; days: number }[] }[] = [
  {
    dim: "优先赛道逐行业",
    items: [
      { q: "科技零售 企业 2027 校园招聘", days: 7 },
      { q: "智能制造 公司 秋季招聘 2027届", days: 7 },
      { q: "消费电子 企业 校招 启动", days: 7 },
      { q: "智能硬件 公司 2027届 招聘", days: 7 },
      { q: "供应链 物流 企业 校园招聘 启动", days: 7 },
      { q: "进出口 外贸 公司 校招 2027", days: 7 },
      { q: "医疗器械 医药 企业 秋招 启动", days: 7 },
      { q: "新能源 制造 实业 校园招聘 2027届", days: 7 },
    ],
  },
  {
    dim: "主流渠道扫描",
    items: [
      { q: "牛客网 秋招 企业 官宣 启动", days: 4 },
      { q: "应届生求职网 校园招聘 最新 启动", days: 4 },
    ],
  },
]

async function executeAudit(season: string): Promise<AuditJobResult> {
  const seasonWord = season === "社招" ? "社会招聘" : season
  const today = shanghaiToday()
  const zai = await ZAI.create()

  // 1) 逐条串行检索（同 sync 的防限流策略），按维度记录报告
  const queryReports: QueryReport[] = []
  const searchResults: { url: string; name: string; snippet: string; host_name: string; date: string; dim: string }[] = []
  const seen = new Set<string>()
  for (const group of AUDIT_SEEDS) {
    for (const { q, days } of group.items) {
      const items = await searchWithRetry(zai, q, days, queryReports)
      for (const item of items) {
        if (!item?.name || seen.has(item.url)) continue
        seen.add(item.url)
        searchResults.push({ ...item, dim: group.dim })
      }
      await sleep(600)
    }
  }
  const failedQueries = queryReports.filter((r) => !r.ok).length

  if (searchResults.length === 0) {
    await persistReport({ season, candidates: [], queryReports, searched: 0, note: "检索颗粒无收" })
    return { candidates: [], searched: 0, failedQueries, message: "本轮检索颗粒无收，稍后再试" }
  }

  // 2) 库内全量名单（含已忽略：用户忽略过的不重复打扰）交给 LLM 排除
  const existing = await db.company.findMany({
    where: { season },
    select: { name: true },
  })
  const normalize = (n: string) => n.replace(/（.*?）/g, "").replace(/\s/g, "")
  const knownNames = existing.map((e) => normalize(e.name)).filter(Boolean)
  const knownBlob = knownNames.join("、")

  // 3) LLM 提炼「库外」企业候选（查漏场景宁多勿漏，仍要求企业主体 + 目标届别 + 近期动态）
  const corpus = searchResults
    .slice(0, 48)
    .map(
      (r, i) =>
        `${i + 1}. [${r.dim}] 标题:${r.name} | 摘要:${r.snippet.slice(0, 180)} | 来源:${r.host_name} | 日期:${r.date || "未知"} | 链接:${r.url}`
    )
    .join("\n")

  const prompt = `今天 ${today}。以下是从多个行业与渠道检索到的${seasonWord}信息片段。
我的名录里已经收录了这些企业（排除清单）：${knownBlob.slice(0, 3500)}
任务：找出「排除清单之外」、最近几天放出了${seasonWord}信息的企业——也就是我可能漏掉的公司。
要求：
- 只输出企业主体（公司/集团/银行/子公司品牌），忽略招聘平台、就业网、汇总文章、中介
- 必须在排除清单之外（名称相似即算已收录，不要输出）
- 优先级：用户的优先赛道（${KNOWN_INDUSTRY.slice(0, 8).join("、")}）中的企业排前面
- 铁律一（届别）：只提取服务「2027届 / 2027校招」的信息${season === "社招" ? "（社招无届别要求）" : ""}；往届信息不提取
- 铁律二（时效）：只提取最近 7 天内的动态
- industry 从这些里选：${KNOWN_INDUSTRY.join("、")}；不符可自拟
- evidence 填命中的标题原文片段（30字内），供人工核实
- city 无法推断写「待核」，禁止编造
- 所有字段值内禁止出现英文双引号（引用原文用「」）；严格输出合法 JSON 数组：[{"name":"...","industry":"...","city":"...","summary":"...","positions":["..."],"sourceName":"...","publishedDay":null,"recruitUrl":"...","evidence":"..."}]
- 最多 15 家；一家都没有就输出 []；宁多勿漏但必须是真实企业条目

信息片段：
${corpus}`

  let candidates: AuditCandidate[] = []
  try {
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: "你是严谨的校招查漏助手，只输出 JSON 数组。" },
        { role: "user", content: prompt },
      ],
      thinking: { type: "disabled" },
    })
    const raw = completion.choices[0]?.message?.content ?? ""
    candidates = parseJsonArrayLoose(raw) as AuditCandidate[]
    // LLM 有输出但一条都没解析出来：视为格式异常而非「零遗漏」，如实报错
    if (candidates.length === 0 && raw.trim().length > 20) {
      throw new Error("AI 输出格式异常，未能提炼候选（可稍后重试体检）")
    }
  } catch (e) {
    throw new Error(`查漏提炼失败：${(e as Error).message.slice(0, 120)}`)
  }

  // 4) 代码层再兑底排除：与库内名称模糊互含的候选剔除
  const filtered = (Array.isArray(candidates) ? candidates : [])
    .filter((c) => c?.name && c.name.trim())
    .map((c) => ({ ...c, name: c.name.trim().slice(0, 30) }))
    .filter((c) => {
      const t = normalize(c.name)
      return !knownNames.some((n) => n && (n.includes(t) || t.includes(n)))
    })
    .slice(0, 15)

  const message =
    filtered.length > 0
      ? `体检发现 ${filtered.length} 家名录之外的企业动态，请逐条核实`
      : failedQueries > 0
        ? `本轮 ${failedQueries}/${queryReports.length} 组检索未成功，建议稍后再体检一次`
        : "交叉核对完成：检索触达的企业名录里都有，暂未发现遗漏"

  await persistReport({ season, candidates: filtered, queryReports, searched: searchResults.length, note: message })
  return { candidates: filtered, searched: searchResults.length, failedQueries, message }
}

async function persistReport(input: {
  season: string
  candidates: AuditCandidate[]
  queryReports: QueryReport[]
  searched: number
  note: string
}) {
  try {
    const value = JSON.stringify({
      at: new Date().toISOString(),
      season: input.season,
      candidates: input.candidates,
      queries: input.queryReports,
      searched: input.searched,
      note: input.note,
    })
    await db.setting.upsert({
      where: { key: "lastAuditReport" },
      create: { key: "lastAuditReport", value },
      update: { value },
    })
  } catch {}
}

/** 上次体检报告（GET /api/audit 读取） */
export async function getLastAuditReport(): Promise<Record<string, unknown> | null> {
  try {
    const row = await db.setting.findUnique({ where: { key: "lastAuditReport" } })
    if (!row?.value) return null
    return JSON.parse(row.value) as Record<string, unknown>
  } catch {
    return null
  }
}
