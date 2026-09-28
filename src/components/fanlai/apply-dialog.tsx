"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api, splitList, STATUS_DOT, STATUS_ORDER, type ApplicationRecord, type Company } from "@/lib/types"
import { toShanghaiDateStr } from "@/lib/date"
import { cn } from "@/lib/utils"

const STATUS_OPTIONS = [...STATUS_ORDER]

const norm = (s: string) => s.trim().toLowerCase()

/**
 * 记一笔投递：同一企业可记录多个岗位，各自独立跟踪进度。
 * - 点已有记录 → 载入该条进入「更新」模式
 * - 输入新岗位名 → 「新增」模式（服务端按岗位名去重兜底）
 */
export function ApplyDialog({
  company,
  apps,
  onClose,
  onSaved,
}: {
  company: Company | null
  apps: ApplicationRecord[]
  onClose: () => void
  onSaved: () => void
}) {
  const [position, setPosition] = useState("")
  const [status, setStatus] = useState<string>("已投递")
  const [channel, setChannel] = useState("")
  const [notes, setNotes] = useState("")
  const [deadline, setDeadline] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const hotPositions = splitList(company?.positions).slice(0, 3)

  useEffect(() => {
    if (company) {
      setPosition("")
      setStatus("已投递")
      setChannel("")
      setNotes("")
      setDeadline("")
      setEditingId(null)
    }
  }, [company])

  // 同名岗位命中已有记录：提示将更新该条（不覆盖已填写的表单值）
  const matched = company ? apps.find((a) => norm(a.position) === norm(position)) ?? null : null
  const editing = editingId ? apps.find((a) => a.id === editingId) ?? null : null

  function loadRecord(a: ApplicationRecord) {
    setEditingId(a.id)
    setPosition(a.position)
    setStatus(a.status)
    setChannel(a.channel ?? "")
    setNotes(a.notes ?? "")
    setDeadline(a.deadline ? toShanghaiDateStr(a.deadline) : "")
  }

  function resetToNew() {
    setEditingId(null)
    setPosition("")
    setStatus("已投递")
    setChannel("")
    setNotes("")
    setDeadline("")
  }

  async function save() {
    if (!company) return
    if (!position.trim()) {
      toast.error("请先填写意向岗位")
      return
    }
    setSaving(true)
    try {
      const res = await api<ApplicationRecord & { created?: boolean }>("/api/applications", {
        method: "POST",
        body: JSON.stringify({
          companyId: company.id,
          position,
          status,
          channel,
          notes,
          deadline,
        }),
      })
      toast.success(
        res.created === false
          ? `「${company.name} · ${position.trim()}」的记录已更新`
          : `已新增「${company.name} · ${position.trim()}」的投递记录`,
        { duration: 2400 }
      )
      onSaved()
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const mode = editing || matched ? "update" : "create"

  return (
    <Dialog open={!!company} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rounded-lg sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="font-display text-lg tracking-wide">
            {apps.length > 0 ? "记投递 · 管理岗位记录" : "记一笔投递"}
          </DialogTitle>
          <DialogDescription className="text-[12.5px]">
            {company?.name} · 同一企业可记录多个岗位，各自独立跟踪进度
          </DialogDescription>
        </DialogHeader>

        {apps.length > 0 && (
          <div className="grid gap-1.5 rounded-md border border-border/80 bg-secondary/40 px-3 py-2.5">
            <p className="text-[10.5px] font-medium tracking-wide text-muted-foreground">
              已有 {apps.length} 条记录，点一条可继续更新
            </p>
            <div className="flex flex-wrap gap-1.5">
              {apps.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => (editingId === a.id ? resetToNew() : loadRecord(a))}
                  aria-pressed={editingId === a.id}
                  title={editingId === a.id ? "点击取消选择，切换为新增" : `载入「${a.position}」的记录继续编辑`}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors",
                    editingId === a.id
                      ? "border-primary/40 bg-accent text-accent-foreground"
                      : "border-border bg-card text-foreground/80 hover:border-foreground/25 hover:bg-secondary/60"
                  )}
                >
                  <span aria-hidden className={cn("size-1.5 rounded-full", STATUS_DOT[a.status] ?? "bg-stone-400")} />
                  <span className="max-w-36 truncate">{a.position}</span>
                  <span className="text-[10.5px] text-muted-foreground">{a.status}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-4 py-1">
          <div className="grid gap-2">
            <Label htmlFor="position" className="text-[12.5px]">
              意向岗位
            </Label>
            <Input
              id="position"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder={hotPositions.length > 0 ? `如：${hotPositions.join(" / ")}` : "如：供应链管培生"}
              className="h-9 rounded-md text-[13px]"
            />
            {editing ? (
              <p className="text-[11px] leading-relaxed text-primary/90">
                正在更新「{editing.position}」的记录 ·{" "}
                <button type="button" onClick={resetToNew} className="underline underline-offset-2 hover:text-foreground">
                  改为新增一条
                </button>
              </p>
            ) : matched ? (
              <p className="text-[11px] leading-relaxed text-primary/90">
                已有「{matched.position}」的记录，保存将更新该条；换一个岗位名则新增记录
              </p>
            ) : (
              mode === "create" &&
              apps.length > 0 && (
                <p className="text-[11px] leading-relaxed text-muted-foreground/70">
                  将为该企业新增一条岗位记录
                </p>
              )
            )}
          </div>

          <div className="grid gap-2">
            <Label className="text-[12.5px]">当前阶段</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 rounded-md text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-md">
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s} className="text-[13px]">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="channel" className="text-[12.5px]">
              投递渠道（选填）
            </Label>
            <Input
              id="channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              placeholder="如：官网 / 内推 / 宣讲会"
              className="h-9 rounded-md text-[13px]"
            />
          </div>

          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <div className="grid gap-2">
              <Label htmlFor="deadline" className="text-[12.5px]">
                下一个关键节点（选填）
              </Label>
              <Input
                id="deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                aria-label="网申截止或下一步节点日期"
                className="h-9 rounded-md text-[13px] tabular-nums"
              />
            </div>
            {deadline && (
              <Button
                variant="ghost"
                onClick={() => setDeadline("")}
                className="h-9 rounded-md px-2.5 text-[12px] text-muted-foreground"
              >
                清除
              </Button>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground/75">
            如网申截止日、笔试日、面试日——设置后看板会为你倒数。
          </p>

          <div className="grid gap-2">
            <Label htmlFor="notes" className="text-[12.5px]">
              备注（选填）
            </Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="DDL、内推人、进展提醒……"
              className="min-h-20 rounded-md text-[13px]"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" className="rounded-md text-[13px]" onClick={onClose}>
            取消
          </Button>
          <Button className="rounded-md text-[13px]" onClick={save} disabled={saving}>
            {saving ? "保存中…" : editing || matched ? "更新该记录" : "新增记录"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
