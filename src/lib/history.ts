// 投递流转轨迹（Application.history JSON 字符串）读写工具
// 结构：[{ status: "已投递", at: "ISO时间" }]，按时间升序追加

export interface HistoryEntry {
  status: string
  at: string
}

export function parseHistory(raw: string | null | undefined): HistoryEntry[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .filter((e) => e && typeof e.status === "string" && typeof e.at === "string")
      .map((e) => ({ status: e.status as string, at: e.at as string }))
  } catch {
    return []
  }
}

/** 追加一条轨迹（状态与末尾相同时不重复记录）；返回序列化后的 JSON 字符串 */
export function appendHistory(raw: string | null | undefined, status: string, at = new Date()): string {
  const list = parseHistory(raw)
  if (list.length > 0 && list[list.length - 1].status === status) {
    // 同状态重复保存：仅刷新时间戳，避免刷屏轨迹
    list[list.length - 1] = { status, at: at.toISOString() }
  } else {
    list.push({ status, at: at.toISOString() })
  }
  // 防御上限：保留最近 50 条
  return JSON.stringify(list.slice(-50))
}
