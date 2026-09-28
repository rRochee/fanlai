// 饭来 · 前端共享类型与工具

export interface Company {
  id: string
  name: string
  fullName: string | null
  industry: string
  city: string
  size: string
  funding: string
  summary: string
  description: string
  positions: string
  tags: string
  recruitUrl: string
  sourceType: string
  sourceName: string
  publishedAt: string
  publishedDay: string
  /** 企业秋招网申截止日期（ISO 字符串，未知为 null） */
  deadline: string | null
  /** 用户在官网亲自核对截止时间的时间戳（null=情报整理值未亲核） */
  deadlineConfirmedAt?: string | null
  /** 招聘官网自动探测结果：ok / soft（反爬或跳转，域名活着）/ fail（不可达，情报慎信）；null=未探测 */
  urlStatus?: string | null
  season: string
  starred: boolean
  pinned: boolean
  verified: boolean
  hidden: boolean
  /** primary application（最近更新的一条，兼容展示）；多条记录时见 applicationCount */
  application?: { id: string; status: string; position: string; deadline?: string | null } | null
  applicationCount?: number
}

export interface HistoryEntry {
  status: string
  at: string
}

export interface ApplicationRecord {
  id: string
  companyId: string
  position: string
  status: string
  channel: string | null
  notes: string | null
  deadline: string | null
  history: HistoryEntry[]
  appliedAt: string
  updatedAt: string
  company: Company
}

export interface LastSyncInfo {
  at: string
  added: number
  refreshed: number
  source: "auto" | "manual"
  season: string
}

export interface Stats {
  today: string
  total: number
  todayCount: number
  starred: number
  focusCount: number
  pendingReview: number
  hiddenCount: number
  upcomingDeadline: number
  season: string
  appliedTotal: number
  byStatus: Record<string, number>
  lastSync: LastSyncInfo | null
  /** 今日新增公众号文章数（搜狗微信直搜管道，可选——旧数据/旧端不返回也兼容） */
  articles?: number
}

export interface BatchInfo {
  date: string
  count: number
  isToday: boolean
}

/** 投递日历（公司网申截止）：单家企业条目（完整 Company 形态，可直喂详情弹层） */
export type DeadlineItem = Company

/** GET /api/deadlines 响应（items 为完整 Company，可直接喂给详情弹层） */
export interface DeadlinesResponse {
  month: string
  today: string
  items: Company[]
  counts: {
    inMonth: number
    urgent3: number
    urgent7: number
    expired: number
    confirmed: number
    withDeadline: number
    noDlCount: number
  }
  /** 未来 7 天内到期的清单（跨月，侧栏倒计时用） */
  upcoming: Company[]
  starredNoDl: { id: string; name: string; industry: string; recruitUrl: string }[]
  /** 官网可达性自动探测汇总（机器只能确认"官网活着"，截止日期仍以官网公告为准） */
  verify: { ok: number; soft: number; fail: number; unchecked: number; lastCheckedAt: string | null }
  /** 今日核对推荐：紧迫（≤3天优先，不足扩到 7 天）且未亲核，官网可达优先 */
  reviewQueue: Company[]
  /** 最近核对记录（打卡动态） */
  recentConfirms: { name: string; at: string }[]
  /** 近 30 天的核对日期（YYYY-MM-DD 去重升序，前端算连续打卡天数） */
  confirmDates: string[]
}

export interface CompaniesResponse {
  items: Company[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
  today: string
}

export const splitList = (s: string | null | undefined): string[] =>
  s ? s.split(",").map((t) => t.trim()).filter(Boolean) : []

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `请求失败（${res.status}）`)
  }
  return res.json() as Promise<T>
}

export const STATUS_ORDER = ["意向中", "已投递", "笔试中", "面试中", "Offer", "暂告段落"] as const

export const SEASONS = ["秋招", "春招", "社招"] as const
export type Season = (typeof SEASONS)[number]

export const STATUS_DOT: Record<string, string> = {
  意向中: "bg-stone-400",
  已投递: "bg-[color:var(--powder)]",
  笔试中: "bg-[color:var(--sky)]",
  面试中: "bg-[color:var(--teal)]",
  Offer: "bg-[color:var(--crimson)]",
  暂告段落: "bg-stone-300",
}
