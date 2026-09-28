// 饭来 · 备份导出（客户端共享：页脚与命令面板复用）
"use client"

import { toast } from "sonner"
import { api } from "@/lib/types"

interface BackupPayload {
  format: "fanlai-backup"
  version: number
  exportedAt: string
  counts: { companies: number; applications: number }
  companies: unknown[]
  applications: unknown[]
}

/** 拉取全量 JSON 并以文件形式下载到本地 */
export async function exportBackup() {
  try {
    const data = await api<BackupPayload>("/api/backup")
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    const day = data.exportedAt.slice(0, 10).replace(/-/g, "")
    a.href = url
    a.download = `fanlai-backup-${day}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`已导出 ${data.counts.companies} 家企业、${data.counts.applications} 条投递记录`)
  } catch (e) {
    toast.error((e as Error).message)
  }
}
