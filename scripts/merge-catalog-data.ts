/**
 * 一次性合并脚本：把 /tmp/fanlai-desc-1.json + /tmp/fanlai-desc-2.json 的
 * deadline 与扩写 description 合入 src/lib/catalog.ts 的 CATALOG。
 * 运行：bun scripts/merge-catalog-data.ts
 */
import { readdirSync, writeFileSync } from "node:fs"
import { CATALOG } from "../src/lib/catalog"
import type { CatalogCompany } from "../src/lib/catalog"

type Item = { deadline: string; description: string }

function loadJson(path: string): Record<string, Item> {
  // bun 支持直接 import json，但为了容错用 require 语义
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path) as Record<string, Item>
}

const merged: Record<string, Item> = {
  ...loadJson("/tmp/fanlai-desc-1.json"),
  ...loadJson("/tmp/fanlai-desc-2.json"),
}

const INDUSTRIES = [
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
] as const

let applied = 0
let missing: string[] = []

const updated: CatalogCompany[] = CATALOG.map((c) => {
  const hit = merged[c.name]
  if (!hit) {
    missing.push(c.name)
    return c
  }
  applied++
  return {
    ...c,
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(hit.deadline) ? hit.deadline : c.deadline,
    description: hit.description.trim() || c.description,
  }
})

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

// 按行业分组重排（原本混排的联想/携程等归位到各自行业区块）
const byIndustry = new Map<string, CatalogCompany[]>()
for (const ind of INDUSTRIES) byIndustry.set(ind, [])
const others: CatalogCompany[] = []
for (const c of updated) {
  if (byIndustry.has(c.industry as (typeof INDUSTRIES)[number])) {
    byIndustry.get(c.industry as (typeof INDUSTRIES)[number])!.push(c)
  } else {
    others.push(c)
  }
}

const blocks: string[] = []
for (const ind of INDUSTRIES) {
  const list = byIndustry.get(ind)!
  if (list.length === 0) continue
  blocks.push(`  // ─────────────── ${ind} ───────────────`)
  blocks.push(list.map(emitEntry).join("\n"))
}
if (others.length) {
  blocks.push(`  // ─────────────── 其他 ───────────────`)
  blocks.push(others.map(emitEntry).join("\n"))
}

const catalogLiteral = `export const CATALOG: CatalogCompany[] = [\n${blocks.join("\n")}\n]\n`

const path = "src/lib/catalog.ts"
const src = readSource(path)
const marker = "export const CATALOG"
const idx = src.indexOf(marker)
if (idx < 0) throw new Error("CATALOG marker not found")
const next = src.slice(0, idx) + catalogLiteral
writeFileSync(path, next)

console.log(`applied=${applied}/${CATALOG.length}, missing=${missing.length}`)
if (missing.length) console.log("missing names:", missing.join("、"))

function readSource(p: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("node:fs").readFileSync(p, "utf8")
}

// 防止 tree-shake 未用变量告警
void readdirSync
