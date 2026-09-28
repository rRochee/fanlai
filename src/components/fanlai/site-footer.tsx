"use client"

import { useRef, useState } from "react"
import { toast } from "sonner"
import { DatabaseBackup, Upload } from "lucide-react"
import { api, SEASONS, type Season } from "@/lib/types"
import { exportBackup } from "@/lib/backup-client"
import { quoteForDay } from "@/lib/quotes"
import { Bowl } from "./bowl"
import { FanLaiLogo } from "./logo"

const SEASON_EN: Record<Season, string> = {
  秋招: "Autumn",
  春招: "Spring",
  社招: "Career",
}

interface BackupPayload {
  format: "fanlai-backup"
  version: number
  exportedAt: string
  counts: { companies: number; applications: number }
  companies: unknown[]
  applications: unknown[]
}

export function SiteFooter({
  season = "秋招",
  today,
  onImported,
}: {
  season?: Season
  today?: string
  onImported?: () => void
}) {
  const seasonWord = (SEASONS as readonly string[]).includes(season) ? season : "秋招"
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [importing, setImporting] = useState(false)
  // 页尾一言：按日期轮换的古籍哲理（见缝插针的定心时刻）
  const quote = today ? quoteForDay(today) : null

  const handleExport = () => exportBackup()

  // 恢复：选择本地备份 JSON，合并导入（同名企业/同岗位记录自动跳过）
  async function handleImport(file: File) {
    if (importing) return
    setImporting(true)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as BackupPayload
      const res = await api<{ message: string }>("/api/backup", {
        method: "POST",
        body: JSON.stringify({ data: parsed }),
      })
      toast.success(res.message, { duration: 5000 })
      onImported?.()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  return (
    <footer className="mt-auto border-t border-border/80 bg-card/55 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-9 text-center sm:flex-row sm:justify-between sm:px-6 sm:text-left">
        <div className="flex items-center gap-2.5">
          <FanLaiLogo size={26} className="rounded-[6px]" />
          <span className="font-display text-[15px] font-semibold tracking-wide">饭来 · {seasonWord}志</span>
          {/* 收尾一句饭来式的祝福：把梗留在页面最后一行 */}
          <span aria-hidden className="hidden h-3.5 w-px bg-border sm:block" />
          <p className="hidden items-center gap-1.5 text-[12px] text-muted-foreground sm:flex">
            <Bowl mood="happy" size={16} />
            今天也要好好吃饭，好好上岸
          </p>
        </div>
        <div className="flex flex-col items-center gap-1 sm:items-start">
          {quote && (
            <p className="font-masthead flex items-center gap-1.5 text-[12.5px] font-bold leading-relaxed text-foreground/80">
              <span aria-hidden className="size-1 rounded-full bg-[color:var(--crimson)]" />
              「{quote.text}」
              <span className="font-sans text-[10.5px] font-normal tracking-[0.14em] text-muted-foreground/70">
                {quote.from}
              </span>
            </p>
          )}
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            先看企业，再挑岗位 · 名录每日送达，信息以各企业招聘官网为准
          </p>
          <p className="hidden text-[10.5px] leading-relaxed text-muted-foreground/75 md:block">
            键盘 1-5 快速切换视图 · ⌘ K 全局搜索企业与视图
          </p>
        </div>
        <div className="flex flex-col items-center gap-2 sm:items-end">
          {/* 数据安全区：两颗醒目的实体按钮（Task 26-j，不再藏在角落的小字里） */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleExport}
              className="flex h-10 items-center gap-2 rounded-md border border-[color:var(--navy-block)]/45 bg-card px-4 text-[13.5px] font-semibold text-foreground shadow-[0_1px_3px_rgba(12,35,64,0.08)] transition-all hover:-translate-y-px hover:border-[color:var(--navy-block)] hover:shadow-[0_3px_10px_rgba(12,35,64,0.14)]"
              title="把全部名录与投递记录导出为 JSON 文件"
            >
              <DatabaseBackup className="size-4.5 text-[color:var(--navy-block)] dark:text-[color:var(--powder)]" strokeWidth={1.7} />
              备份数据
            </button>
            <button
              type="button"
              disabled={importing}
              onClick={() => fileRef.current?.click()}
              className="flex h-10 items-center gap-2 rounded-md bg-[color:var(--navy-block)] px-4 text-[13.5px] font-semibold text-white shadow-[0_2px_8px_rgba(12,35,64,0.28)] transition-all hover:-translate-y-px hover:brightness-110 disabled:opacity-60"
              title="从备份 JSON 恢复（同名企业/同岗位自动跳过，不会重复）"
            >
              <Upload className="size-4.5" strokeWidth={1.7} />
              {importing ? "恢复中…" : "恢复备份"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label="选择备份文件"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleImport(f)
              }}
            />
          </div>
          <p className="text-[10.5px] leading-relaxed text-muted-foreground/70">
            换设备 / 清缓存前，先备份一份；恢复时同名自动去重
          </p>
        </div>
      </div>
      <p className="kicker pb-4 text-center text-[10px] text-muted-foreground/70">
        2026 {SEASON_EN[seasonWord as Season]} · FanLai
      </p>
    </footer>
  )
}
