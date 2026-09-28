// 饭来 · 同步执行报告共享类型（refresh 路由写入 / sync-status 读取 / 前端渲染共用）

export interface QueryReportLike {
  q: string
  ok: boolean
  hits: number
  attempts: number
  error?: string
}

export interface SyncReport {
  at: string
  season: string
  source: "auto" | "manual"
  searched: number
  added: number
  refreshed: number
  llm: "ok" | "skipped" | "fail"
  queries: QueryReportLike[] | null
  okCount: number | null
  failCount: number | null
}

export interface SyncPipelineStep {
  step: string
  detail: string
}

export interface SyncStatus {
  today: string
  season: string
  /** 当前同步后台任务状态（202 受理后轮询取进度与结果） */
  job?: {
    running: boolean
    season: string
    source: "auto" | "manual"
    startedAt: number
    finishedAt: number | null
    elapsedMs: number
    /** 当前阶段描述（如「搜狗微信情报抓取中…」），可选向后兼容 */
    phase?: string | null
    result: {
      added: number
      refreshed: number
      skipped: number
      items: string[]
      refreshedItems: string[]
      searched: number
      failedQueries: number
      message: string
    } | null
    error: string | null
  }
  schedule: { pushHour: number; checkEveryMinutes: number; timezone: string; text: string }
  pipeline: SyncPipelineStep[]
  limitations: readonly string[]
  coverage: {
    total: number
    verifiedCount: number
    pendingCount: number
    hiddenCount: number
    todayCount: number
    recentBatches: { date: string; count: number }[]
  }
  lastSync: { at: string; added: number; refreshed: number; source: string; season: string } | null
  lastReport: SyncReport | null
}

/** 查漏体检：疑似遗漏候选（AI 提炼，待用户裁决） */
export interface AuditCandidate {
  name: string
  industry?: string
  city?: string
  summary?: string
  positions?: string[]
  sourceName?: string
  publishedDay?: string | null
  recruitUrl?: string
  evidence?: string
}

/** GET /api/audit 响应 */
export interface AuditStatus {
  job: {
    running: boolean
    season: string
    startedAt: number
    finishedAt: number | null
    elapsedMs: number
    result: { candidates: AuditCandidate[]; searched: number; failedQueries: number; message: string } | null
    error: string | null
  }
  lastReport: {
    at: string
    season: string
    candidates: AuditCandidate[]
    searched: number
    note: string
    queries?: QueryReportLike[]
  } | null
}
