/**
 * 一次性合并脚本（Task 24-a）：把 /tmp/fanlai-expand-1.json（62 家）与
 * /tmp/fanlai-expand-2.json（63 家）的新企业合并进 src/lib/catalog.ts 的 CATALOG。
 *
 * 规则：
 *  - 跨批去重：同名只留一条；「哔哩哔哩」两批都出现 → 保留 expand-1（互联网与软件）版本
 *  - 与现有 113 家查重：命中即丢弃并记录
 *  - 行业映射：新条目 industry 必须能对上 catalog.ts 的 INDUSTRIES 常量（18 个），
 *    能对上则原样使用（本批已验证全部命中，无需映射），对不上则脚本直接报错退出
 *  - 插入方式：文本级操作——把新条目追加到各自行业分组的最后一个条目之后，
 *    现有 113 家条目保持字节级不变
 *
 * 运行：bun scripts/merge-expand-125.ts
 */
import { readFileSync, writeFileSync } from "node:fs"

type Raw = Omit<CatalogCompany, "name"> & Partial<Pick<CatalogCompany, "name">>
type CatalogCompany = {
  name: string
  fullName?: string
  industry: string
  city: string
  size: string
  funding: string
  summary: string
  description: string
  positions: string[]
  tags: string[]
  recruitUrl: string
  sourceType: string
  sourceName: string
  deadline?: string
  batchOffset: number
}

function loadJson(path: string): Record<string, Raw> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path) as Record<string, Raw>
}

const PATH = "src/lib/catalog.ts"
const src = readFileSync(PATH, "utf8")

// ── 1. 提取 catalog.ts 现有全部 name（查重基线）─────────────────────────
const existingNames = [...src.matchAll(/^ {4}name: "([^"]+)",$/gm)].map((m) => m[1])
const existingSet = new Set(existingNames)
if (new Set(existingNames).size !== existingNames.length) {
  throw new Error("现有 CATALOG 内部已存在重名，中止")
}
console.log(`现有企业：${existingNames.length} 家`)

// ── 2. 现有全部 industry 值 + INDUSTRIES 常量（映射目标）────────────────
const industriesConst = [
  ...src.matchAll(/export const INDUSTRIES = \[([\s\S]*?)\] as const/g),
][0][1]
  .split("\n")
  .map((l) => (l.match(/"([^"]+)"/) || [])[1])
  .filter(Boolean) as string[]
const existingIndustries = [
  ...new Set([...src.matchAll(/^ {4}industry: "([^"]+)",$/gm)].map((m) => m[1])),
]
console.log(`INDUSTRIES 常量（${industriesConst.length}）：${industriesConst.join("、")}`)
console.log(`CATALOG 在用行业（${existingIndustries.length}）：${existingIndustries.join("、")}`)

// ── 3. 加载两批 JSON，跨批去重（expand-1 优先）──────────────────────────
const j1 = loadJson("/tmp/fanlai-expand-1.json")
const j2 = loadJson("/tmp/fanlai-expand-2.json")
const crossDup = Object.keys(j1).filter((k) => k in j2)
console.log(`跨批重名（保留 expand-1 版本，丢弃 expand-2）：${crossDup.join("、") || "无"}`)
for (const k of crossDup) delete j2[k]

// ── 4. 行业映射 + 与现有 113 家查重 ────────────────────────────────────
const SOURCE_TYPE = new Set(["公众号", "服务号", "官网", "招聘平台"])
const industryMap = new Map<string, string>() // 记录非恒等映射（若有）
const dropped: string[] = []
const merged: CatalogCompany[] = []

for (const [batch, obj] of [
  ["expand-1", j1],
  ["expand-2", j2],
] as const) {
  for (const [name, raw] of Object.entries(obj)) {
    if (existingSet.has(name)) {
      dropped.push(`${name}（${batch}，与现有 ${existingNames.length} 家重名）`)
      continue
    }
    // 行业映射：精确命中 → 原样；未命中 → 尝试包含式归并，仍失败则报错
    let ind = raw.industry
    if (!industriesConst.includes(ind)) {
      const hit = industriesConst.find(
        (c) => ind.includes(c) || c.includes(ind),
      )
      if (!hit) throw new Error(`「${name}」行业「${ind}」无法映射到现有行业列表，中止`)
      industryMap.set(ind, hit)
      ind = hit
    }
    if (!SOURCE_TYPE.has(raw.sourceType)) {
      throw new Error(`「${name}」sourceType 非法：${raw.sourceType}`)
    }
    if (!raw.deadline || !/^\d{4}-\d{2}-\d{2}$/.test(raw.deadline)) {
      throw new Error(`「${name}」deadline 非法：${raw.deadline}`)
    }
    merged.push({
      name,
      fullName: raw.fullName,
      industry: ind,
      city: raw.city,
      size: raw.size,
      funding: raw.funding,
      summary: raw.summary,
      description: raw.description,
      positions: raw.positions,
      tags: raw.tags,
      recruitUrl: raw.recruitUrl,
      sourceType: raw.sourceType,
      sourceName: raw.sourceName,
      deadline: raw.deadline,
      batchOffset: raw.batchOffset,
    })
    existingSet.add(name)
  }
}
console.log(`跨批合并后新增：${merged.length} 家；丢弃：${dropped.length ? dropped.join("；") : "无"}`)
console.log(`行业映射（非恒等）：${industryMap.size ? [...industryMap].map(([a, b]) => `${a}→${b}`).join("、") : "无（两批 industry 全部精确命中现有 18 行业）"}`)

// ── 5. 生成条目文本（严格沿用现有排版）─────────────────────────────────
const q = (s: string) => JSON.stringify(s)
function emitEntry(c: CatalogCompany): string {
  const lines: string[] = ["  {"]
  lines.push(`    name: ${q(c.name)},`)
  if (c.fullName) lines.push(`    fullName: ${q(c.fullName)},`)
  lines.push(`    industry: ${q(c.industry)},`)
  lines.push(`    city: ${q(c.city)},`)
  lines.push(`    size: ${q(c.size)},`)
  lines.push(`    funding: ${q(c.funding)},`)
  lines.push(`    summary: ${q(c.summary)},`)
  lines.push(`    description:`)
  lines.push(`      ${q(c.description)},`)
  lines.push(`    positions: [${c.positions.map(q).join(", ")}],`)
  lines.push(`    tags: [${c.tags.map(q).join(", ")}],`)
  lines.push(`    recruitUrl: ${q(c.recruitUrl)},`)
  lines.push(`    sourceType: ${q(c.sourceType)},`)
  lines.push(`    sourceName: ${q(c.sourceName)},`)
  if (c.deadline) lines.push(`    deadline: ${q(c.deadline)},`)
  lines.push(`    batchOffset: ${c.batchOffset},`)
  lines.push("  },")
  return lines.join("\n")
}

// ── 6. 按行业分组，插入到各自分组最后一个条目之后（倒序插入防位移）──────
const lines = src.split("\n")
const byIndustry = new Map<string, CatalogCompany[]>()
for (const c of merged) {
  if (!byIndustry.has(c.industry)) byIndustry.set(c.industry, [])
  byIndustry.get(c.industry)!.push(c)
}

const headerRe = /^ {2}\/\/ ─+ (.+) ─+$/
const headerIdx: { line: number; ind: string }[] = []
lines.forEach((l, i) => {
  const m = l.match(headerRe)
  if (m) headerIdx.push({ line: i, ind: m[1] })
})
console.log(`找到行业分组：${headerIdx.length} 个`)

const insertions: { at: number; text: string }[] = []
const stats: string[] = []
for (const [ind, list] of byIndustry) {
  const h = headerIdx.find((x) => x.ind === ind)
  if (!h) throw new Error(`catalog.ts 中没有「${ind}」分组，中止`)
  // 分组正文范围：组头下一行 → 下一个组头（或 CATALOG 结束的 "]") 之前
  const nextHeader = headerIdx.find((x) => x.line > h.line)?.line
  let end = nextHeader ?? lines.length
  while (end > h.line && lines[end - 1]?.trim() === "]") end--
  // 组内最后一个条目结束行（恰为两个空格缩进的 "},"）
  let last = -1
  for (let i = h.line + 1; i < end; i++) {
    if (lines[i] === "  },") last = i
  }
  if (last < 0) throw new Error(`「${ind}」分组内未找到条目结束行`)
  insertions.push({ at: last + 1, text: list.map(emitEntry).join("\n") })
  stats.push(`${ind} +${list.length}（现有组尾第 ${last + 1} 行后）`)
}
insertions.sort((a, b) => b.at - a.at)
for (const ins of insertions) lines.splice(ins.at, 0, ...ins.text.split("\n"))

const out = lines.join("\n")
writeFileSync(PATH, out)

// ── 7. 复核统计 ────────────────────────────────────────────────────────
const finalNames = [...out.matchAll(/^ {4}name: "([^"]+)",$/gm)].map((m) => m[1])
const finalIndustries = new Map<string, number>()
for (const m of out.matchAll(/^ {4}industry: "([^"]+)",$/gm)) {
  finalIndustries.set(m[1], (finalIndustries.get(m[1]) || 0) + 1)
}
console.log(`\n插入明细：${stats.join("；")}`)
console.log(`合并后 CATALOG 总数：${finalNames.length}（去重后唯一名 ${new Set(finalNames).size}）`)
console.log(
  `行业分布：${[...finalIndustries].map(([k, v]) => `${k} ${v}`).join(" / ")}`,
)
if (new Set(finalNames).size !== finalNames.length) throw new Error("合并后出现重名，请检查")
console.log("OK")
