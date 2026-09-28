// 饭来 · Agent 情报入库脚本（本地运行，替代 z-ai 管道不可用时的同步）
// 用法：node scripts/agent-sync.mjs '<json数组>'
// 规则与 src/lib/sync-job.ts executeSyncCore 对齐：
//   去重（名称归一化互相包含）、14 天旧闻守卫、往届届别守卫、上限 12 家、
//   入库后更新 lastRefreshDate / lastSyncLog / lastSyncReport。
// 环境变量：
//   DATABASE_URL（缺省用 .env 里的 file:../db/custom.db）
//   SEASON（缺省 秋招）

import { PrismaClient } from "@prisma/client";
import fs from "node:fs";

const db = new PrismaClient();
const SEASON = process.env.SEASON || "秋招";
const STALE_DAYS = 14;

function shanghaiToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function parseDateStr(s) {
  // 与应用 src/lib/date.ts 保持一致：存 UTC 零点（上海日历日），否则 API 按日过滤查不到
  return new Date(`${s}T00:00:00Z`);
}
function daysUntil(day, todayStr) {
  return Math.round((parseDateStr(day).getTime() - parseDateStr(todayStr).getTime()) / 86400000);
}
function normalizeCity(raw) {
  const v = (raw ?? "").trim().slice(0, 20);
  if (!v || ["未知", "未注明", "不详", "无", "待定", "unknown", "none", "n/a", "-"].includes(v.toLowerCase())) return "待核";
  return v;
}
function parseJsonArrayLoose(raw) {
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    return JSON.parse(m[0]);
  } catch {
    try {
      return JSON.parse(m[0].replace(/,\s*]/g, "]").replace(/'/g, '"'));
    } catch {
      return [];
    }
  }
}

async function main() {
  const arg = process.argv[2];
  let items;
  if (arg && arg.trim().startsWith("[")) {
    items = parseJsonArrayLoose(arg);
  } else if (arg && fs.existsSync(arg)) {
    items = parseJsonArrayLoose(fs.readFileSync(arg, "utf-8"));
  } else {
    console.error("用法：node scripts/agent-sync.mjs '<json数组 或 json文件路径>'");
    process.exit(1);
  }

  const today = shanghaiToday();
  const existing = await db.company.findMany({ select: { id: true, name: true, publishedAt: true, season: true } });
  const normalize = (n) => n.replace(/（.*?）/g, "").replace(/\s/g, "");
  const findExisting = (name) => {
    const target = normalize(name);
    return existing.find((e) => {
      const n = normalize(e.name);
      return n.includes(target) || target.includes(n);
    });
  };
  const isStale = (day) => {
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    return daysUntil(day, today) < -STALE_DAYS + 1;
  };
  const y = parseInt(today.slice(0, 4), 10);
  const m = parseInt(today.slice(5, 7), 10);
  const cohort = SEASON === "社招" ? null : m >= 7 ? y + 1 : y;
  const staleCohorts = cohort ? Array.from({ length: 3 }, (_, i) => `${cohort - 1 - i}届`) : [];
  const hasStaleCohort = (c) => {
    const blob = [c.summary ?? "", (c.positions ?? []).join(","), c.sourceName ?? ""].join(" ");
    return staleCohorts.some((mark) => blob.includes(mark));
  };

  let added = 0, refreshed = 0, skipped = 0;
  const addedItems = [], refreshedItems = [];

  for (const c of items.slice(0, 12)) {
    if (!c?.name || !c.name.trim()) continue;
    const name = c.name.trim().slice(0, 30);
    if (isStale(c.publishedDay) || hasStaleCohort(c)) { skipped++; console.log(`SKIP(旧闻/往届): ${name}`); continue; }
    const dup = findExisting(name);
    if (dup) {
      if (daysUntil(dup.publishedAt.toISOString().slice(0, 10), today) <= -STALE_DAYS && dup.season === SEASON) {        const dynamicNote = c.publishedDay ? `本次动态日期：${c.publishedDay}。` : "";
        await db.company.update({
          where: { id: dup.id },
          data: {
            publishedAt: parseDateStr(today),
            summary: (c.summary ?? "").slice(0, 40) || undefined,
            sourceName: (c.sourceName ?? "公开网络").slice(0, 40),
            description: `饭来情报通道于 ${today} 检测到该企业新的${SEASON}动态，已更新送达批次。${dynamicNote}${(c.summary ?? "").slice(0, 80)}`.slice(0, 240),
          },
        });
        refreshed++; refreshedItems.push(name);
        console.log(`REFRESH: ${name}`);
      } else { skipped++; console.log(`SKIP(重复): ${name}`); }
      continue;
    }
    await db.company.create({
      data: {
        name,
        industry: (c.industry ?? "其他行业").slice(0, 12),
        city: normalizeCity(c.city),
        size: "待核",
        funding: "待核",
        summary: (c.summary ?? "AI 情报，待人工核实").slice(0, 40),
        description: `本条由饭来情报通道于 ${today} 从公开网络抓取提炼${c.publishedDay ? `（动态日期 ${c.publishedDay}）` : ""}，标注为待核状态。摘要：${(c.summary ?? "").slice(0, 80)}。建议访问来源核实后投递。`,
        positions: (c.positions ?? []).slice(0, 4).join(",") || "待核",
        tags: "AI情报",
        recruitUrl: (c.recruitUrl ?? "https://www.nowcoder.com").slice(0, 300),
        sourceType: "情报抓取",
        sourceName: (c.sourceName ?? "公开网络").slice(0, 40),
        publishedAt: parseDateStr(today),
        season: SEASON,
        verified: false,
      },
    });
    added++; addedItems.push(name);
    console.log(`ADDED: ${name}`);
  }

  const parts = [];
  if (added > 0) parts.push(`新收录 ${added} 家（待核）：${addedItems.join("、")}`);
  if (refreshed > 0) parts.push(`重新送达 ${refreshed} 家：${refreshedItems.join("、")}`);
  const message = parts.length > 0 ? parts.join("；") : "本轮情报与现有名录重复或为旧闻，未新增";

  const nowIso = new Date().toISOString();
  const log = JSON.stringify({ at: nowIso, added, refreshed, source: "agent", season: SEASON, message });
  await db.setting.upsert({ where: { key: "lastSyncLog" }, create: { key: "lastSyncLog", value: log }, update: { value: log } });
  await db.setting.upsert({ where: { key: "lastSyncReport" }, create: { key: "lastSyncReport", value: log }, update: { value: log } });
  if (added + refreshed > 0 || items.length > 0) {
    await db.setting.upsert({ where: { key: "lastRefreshDate" }, create: { key: "lastRefreshDate", value: today }, update: { value: today } });
  }

  console.log(`\nDONE added=${added} refreshed=${refreshed} skipped=${skipped} | ${message}`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
