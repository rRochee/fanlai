import { promises as fs } from "node:fs"
import path from "node:path"

import { db } from "@/lib/db"
import { domainFromUrl } from "@/lib/logo"

/**
 * LOGO 缓存审计 API（Task 30-d 新建）：供巡检与人工补图用
 *
 * GET /api/logo-audit
 *   → {
 *       total:        number   // DB 唯一域名数（Company.hidden=false 的 recruitUrl 提取注册主域后去重）
 *       cached:       number   // 其中磁盘已有 LOGO 的域名数（total - missing.length）
 *       missing:      string[] // 尚无 LOGO 的域名（字典序），供人工补图 / 复查
 *       cachedFiles:  number   // public/logos 全部 .img 文件数（含已不在名录渲染集的历史缓存，仅参考）
 *       companies:    number   // DB 参与统计的企业数（hidden=false）
 *       noDomain:     number   // recruitUrl 提不出注册主域的企业数（前端天然走字标）
 *       generatedAt:  string   // ISO 时间戳
 *     }
 *
 * 域名清单来源选型（Task 30-d 结论）：读 DB 而非 src/lib/catalog.ts——
 * 名录页实际渲染的是 DB Company（含 AI 情报新增企业，如 huawei.com / siemens.com 只在 DB），
 * 实测 DB 域名集合是 catalog 的严格超集（catalog 232 ⊂ DB 254，2026-09 时点），
 * 审计口径与前端展示口径一致，才是「用户看到的缺失」。
 *
 * 缓存判定与 /api/logo、warm-logos 三方一致：public/logos/{domain}.img 存在且 >0 字节
 * （0 字节残文件由 API 侧自愈重抓，视为未缓存）。
 */

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const LOGO_DIR = path.join(process.cwd(), "public", "logos")

export async function GET(): Promise<Response> {
  // 1) 域名清单：名录页渲染数据源 DB Company（hidden=false）
  let domains = new Set<string>()
  let companies = 0
  let noDomain = 0
  try {
    const rows = await db.company.findMany({
      where: { hidden: false },
      select: { recruitUrl: true },
    })
    companies = rows.length
    for (const r of rows) {
      const d = domainFromUrl(r.recruitUrl)
      if (d) domains.add(d)
      else noDomain++
    }
  } catch (e) {
    return Response.json(
      { error: `DB 读取失败：${(e as Error).message}` },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }

  // 2) 磁盘缓存扫描（>0 字节才算已缓存，与预热脚本/代理口径一致）
  const cachedSet = new Set<string>()
  let cachedFiles = 0
  try {
    for (const name of await fs.readdir(LOGO_DIR)) {
      if (!name.endsWith(".img")) continue
      try {
        if ((await fs.stat(path.join(LOGO_DIR, name))).size > 0) {
          cachedSet.add(name.slice(0, -4))
          cachedFiles++
        }
      } catch {
        // 文件刚好被清理等竞态，忽略
      }
    }
  } catch {
    // 目录尚不存在 = 零缓存
  }

  const missing = [...domains].filter((d) => !cachedSet.has(d)).sort()

  return Response.json(
    {
      total: domains.size,
      cached: domains.size - missing.length,
      missing,
      cachedFiles,
      companies,
      noDomain,
      generatedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
