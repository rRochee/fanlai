"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { toast } from "sonner"
import { Check, Clock, Copy, EyeOff, ExternalLink, NotebookPen, RotateCcw, Star, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { splitList, api, STATUS_DOT, type ApplicationRecord, type Company } from "@/lib/types"
import { INDUSTRY_COVER } from "@/lib/catalog"
import { dateLabel, toShanghaiDateStr, weekdayLabel } from "@/lib/date"
import { companyDeadline } from "@/lib/deadline"
import { cn } from "@/lib/utils"
import { domainFromUrl } from "@/lib/logo"
import { CompanyAvatar } from "./company-avatar"
import { briefDescription } from "./company-row"

/** 单条投递记录的删除入口：弱化呈现，hover 转危险色，不抢轨迹阅读的注意力 */
function DeleteAppButton({
  onClick,
  label,
  className,
}: {
  onClick: () => void
  label: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-muted-foreground/70 transition-[color,background-color] duration-150 hover:bg-secondary hover:text-destructive focus-visible:text-destructive",
        className
      )}
    >
      <Trash2 className="size-3" strokeWidth={1.6} />
      删除
    </button>
  )
}

/** 面试笔记：每条投递记录一份随行备忘（面试反馈 / 进展纪要 / 复盘），点开即改 */
function NoteEditor({
  app,
  onSave,
}: {
  app: ApplicationRecord
  onSave: (app: ApplicationRecord, notes: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(app.notes ?? "")
  const [saving, setSaving] = useState(false)
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  // 切换记录（同企业多岗位）时重置编辑态内容
  useEffect(() => {
    setValue(app.notes ?? "")
    setEditing(false)
  }, [app.id, app.notes])

  useEffect(() => {
    if (editing) taRef.current?.focus()
  }, [editing])

  async function save() {
    if (saving) return
    const next = value.trim()
    if (next === (app.notes ?? "")) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await onSave(app, next)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="mt-2.5 rounded-md border border-primary/30 bg-accent/50 p-2.5">
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="面试反馈、流程进展、联系人、复盘要点…"
          rows={3}
          maxLength={500}
          className="w-full resize-y rounded-[4px] border border-border bg-background px-2.5 py-2 text-[12.5px] leading-relaxed outline-none placeholder:text-muted-foreground/75 focus-visible:border-primary/50"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault()
              save()
            }
          }}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10.5px] tabular-nums text-muted-foreground/80">{value.length}/500 · ⌘Enter 保存</span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 rounded-md px-2 text-[12px] text-muted-foreground hover:text-foreground"
              onClick={() => {
                setValue(app.notes ?? "")
                setEditing(false)
              }}
            >
              <X className="mr-0.5 size-3" strokeWidth={1.6} />
              取消
            </Button>
            <Button
              size="sm"
              disabled={saving}
              className="h-7 rounded-md px-3 text-[12px]"
              onClick={save}
            >
              <Check className="mr-0.5 size-3" strokeWidth={1.8} />
              {saving ? "保存中…" : "保存笔记"}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (app.notes) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group mt-2.5 block w-full rounded-md border border-border/70 bg-secondary/40 px-3 py-2.5 text-left transition-colors hover:border-foreground/20 hover:bg-secondary/60"
      >
        <span className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
          <NotebookPen className="size-3" strokeWidth={1.6} />
          笔记
        </span>
        <span className="mt-1 block whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/80">{app.notes}</span>
        <span className="mt-1 block text-[10.5px] text-muted-foreground/75 transition-colors group-hover:text-foreground/70">
          点击编辑
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="mt-2 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-muted-foreground/70 transition-[color,background-color] duration-150 hover:bg-secondary hover:text-foreground"
    >
      <NotebookPen className="size-3" strokeWidth={1.6} />
      添加笔记
    </button>
  )
}

/** 企业详情侧滑：完整简介 + 热招方向 + 来源 + 操作 + 同行业推荐 */
export function CompanyDetail({
  company,
  onClose,
  onApply,
  onStar,
  onVerified,
  onHidden,
  onOpenCompany,
  onDeleteApp,
  onUpdateNotes,
  apps,
}: {
  company: Company | null
  onClose: () => void
  onApply: (c: Company) => void
  onStar: (c: Company) => void
  onVerified: (c: Company) => void
  onHidden: (c: Company, hidden: boolean) => void
  onOpenCompany: (c: Company) => void
  onDeleteApp: (app: ApplicationRecord) => void
  onUpdateNotes: (app: ApplicationRecord, notes: string) => Promise<void>
  apps: ApplicationRecord[] | null
}) {
  const [verifying, setVerifying] = useState(false)
  const [hiding, setHiding] = useState(false)
  const [pendingDeleteApp, setPendingDeleteApp] = useState<ApplicationRecord | null>(null)
  // 同行业推荐：打开/切换企业时拉取，点击后侧滑内直接切换
  const [similar, setSimilar] = useState<Company[] | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  async function confirmVerify() {
    if (!company || verifying) return
    setVerifying(true)
    try {
      await api<Company>(`/api/companies/${company.id}`, {
        method: "PATCH",
        body: JSON.stringify({ verify: true }),
      })
      toast.success(`已确认收录「${company.name}」，正式进入已核目录`)
      onVerified(company)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setVerifying(false)
    }
  }

  async function confirmHidden(hidden: boolean) {
    if (!company || hiding) return
    setHiding(true)
    try {
      onHidden(company, hidden)
    } finally {
      setHiding(false)
    }
  }

  // 拉取同行业其他企业（同季、未忽略，最多 4 家）：切换企业时重拉并回顶
  useEffect(() => {
    if (!company) {
      setSimilar(null)
      return
    }
    let alive = true
    setSimilar(null)
    const run = async () => {
      try {
        const sp = new URLSearchParams({
          industry: company.industry,
          season: company.season,
          pageSize: "8",
          sort: "newest",
        })
        const res = await api<{ items: Company[] }>(`/api/companies?${sp.toString()}`)
        if (!alive) return
        setSimilar(res.items.filter((c) => c.id !== company.id).slice(0, 4))
      } catch {
        if (alive) setSimilar([])
      }
    }
    run()
    return () => {
      alive = false
    }
  }, [company?.id, company?.industry, company?.season])

  // 切换到另一家企业时，把侧滑滚回顶部，从新封面开始读
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [company?.id])

  if (!company) return null
  const cover = INDUSTRY_COVER[company.industry as keyof typeof INDUSTRY_COVER]
  const positions = splitList(company.positions)
  const tags = splitList(company.tags)
  const appList = apps ?? []
  // AI 情报的描述是模板拼接文本（「本条由饭来 AI 情报通道…摘要：…建议访问来源核实后投递。」），
  // 展示时只留核心摘要，模板说明交给「信息来源」小节与待核徽标表达
  const rawDesc = company.description
  const desc = briefDescription(rawDesc, rawDesc)
  const ddl = companyDeadline(company.deadline)
  const timeFmt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })

  return (
    <Sheet open={!!company} onOpenChange={(open) => !open && onClose()}>
      <SheetContent ref={scrollRef} side="right" className="scroll-thin w-full overflow-y-auto p-0 sm:max-w-md">
        <div className="cover-img relative aspect-[16/9] w-full overflow-hidden">
          {cover && (
            <Image src={cover} alt={`${company.industry}行业示意插画`} fill sizes="448px" className="art-img object-cover" />
          )}
        </div>

        <div className="px-6 pb-10 pt-5">
          <SheetHeader className="p-0 text-left">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3.5">
                <CompanyAvatar
                  name={company.name}
                  industry={company.industry}
                  className="size-16 shrink-0 rounded-xl text-[24px]"
                  logoDomain={domainFromUrl(company.recruitUrl)}
                />
                <div className="min-w-0">
                  <SheetTitle className="font-display text-xl font-semibold tracking-wide">
                    {company.name}
                  </SheetTitle>
                  {company.fullName && (
                    <SheetDescription className="mt-0.5 text-[12px]">{company.fullName}</SheetDescription>
                  )}
                </div>
              </div>
              <button
                onClick={() => onStar(company)}
                aria-label={company.starred ? "取消星标" : "加入星标"}
                className={cn(
                  "mt-1 flex size-8 items-center justify-center rounded-md border border-border transition-colors",
                  company.starred ? "text-primary hover:bg-accent" : "text-muted-foreground hover:bg-secondary"
                )}
              >
                <Star className={cn("size-4", company.starred && "fill-primary")} strokeWidth={1.6} />
              </button>
            </div>
          </SheetHeader>

          <div className="mt-4 flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="rounded-[4px] font-normal">
              {company.industry}
            </Badge>
            {!company.verified && (
              <span className="rounded-full border border-[color:var(--crimson)]/40 bg-[color:var(--crimson-soft)] px-2.5 py-0.5 text-[11px] text-[color:var(--crimson-deep)]">
                AI 情报 · 待人工核实
              </span>
            )}
            <Badge variant="outline" className="rounded-[4px] font-normal text-muted-foreground">
              {company.city}
            </Badge>
            {/* AI 情报的规模/融资未核实时不重复展示「待核」，由琥珀徽标统一说明 */}
            {company.size !== "待核" && (
              <Badge variant="outline" className="rounded-[4px] font-normal text-muted-foreground">
                {company.size}
              </Badge>
            )}
            {company.funding !== "待核" && (
              <Badge variant="outline" className="rounded-[4px] font-normal text-muted-foreground">
                {company.funding}
              </Badge>
            )}
          </div>

          {/* 一句话亮点：页首扫一眼就知道这家公司是干嘛的 */}
          <p className="mt-4 border-l-2 border-[color:var(--sky)]/60 pl-3 text-[14px] font-medium leading-relaxed text-foreground/90">
            {company.summary}
          </p>

          {/* 企业秋招网申截止（企业口径，与下方投递记录里的 DDL 是两回事） */}
          {ddl &&
            (ddl.d < 0 ? (
              <div className="mt-3.5 flex items-center gap-2 rounded-md border border-border/80 bg-secondary/50 px-3 py-2.5 text-muted-foreground">
                <Clock aria-hidden className="size-4 shrink-0" strokeWidth={1.6} />
                <p className="text-[13px] tabular-nums">网申已截止 · {ddl.day}</p>
              </div>
            ) : (
              <div className="mt-3.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border border-[color:var(--crimson)]/30 bg-[color:var(--crimson-soft)]/55 px-3 py-2.5">
                <Clock aria-hidden className="size-4 shrink-0 text-[color:var(--crimson-deep)]" strokeWidth={1.6} />
                <p className="text-[13.5px] font-medium tabular-nums text-[color:var(--crimson-deep)]">
                  网申截止 {ddl.day}
                  <span className="font-normal"> · {ddl.d === 0 ? "今天截止" : `剩 ${ddl.d} 天`}</span>
                </p>
              </div>
            ))}

          {/* 关于这家公司：完整简介全文展示，不再截断 */}
          <section aria-label="关于这家公司" className="mt-6">
            <div className="flex items-center gap-3">
              <h4 className="kicker shrink-0 text-[10px] text-muted-foreground">关于这家公司</h4>
              <span aria-hidden className="h-px flex-1 bg-border/60" />
            </div>
            <p className="mt-3 text-[15px] leading-[1.9] text-foreground/85">{desc}</p>
          </section>

          {!company.verified && !company.hidden && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-[color:var(--crimson)]/30 bg-[color:var(--crimson-soft)]/60 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[12.5px] font-medium text-[color:var(--crimson-deep)]">AI 情报 · 待人工核实</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-[color:var(--crimson-deep)]/75">
                  核实无误后收录进已核目录，或忽略后从名录隐藏
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={hiding || verifying}
                  onClick={() => confirmHidden(true)}
                  aria-label={`忽略「${company.name}」`}
                  className="h-8 rounded-md border-border/80 px-2.5 text-[12px] text-muted-foreground hover:text-foreground dark:border-border dark:bg-transparent dark:text-muted-foreground dark:hover:text-foreground"
                >
                  <EyeOff className="mr-1 size-3.5" strokeWidth={1.6} />
                  忽略
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={verifying || hiding}
                  onClick={confirmVerify}
                  className="h-8 rounded-md border-[color:var(--crimson)]/45 px-3 text-[12px] text-[color:var(--crimson-deep)] hover:bg-[color:var(--crimson-soft)]"
                >
                  {verifying ? "确认中…" : "确认收录"}
                </Button>
              </div>
            </div>
          )}

          {company.hidden && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-border/80 bg-secondary/50 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-muted-foreground">已忽略的条目</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/75">
                  不再出现在今日与名录，恢复后重新可见
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={hiding}
                onClick={() => confirmHidden(false)}
                className="h-8 shrink-0 rounded-md px-3 text-[12px]"
              >
                <RotateCcw className="mr-1 size-3.5" strokeWidth={1.6} />
                恢复显示
              </Button>
            </div>
          )}

          {tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-primary/20 bg-accent px-2.5 py-0.5 text-[11px] text-accent-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          <Separator className="my-5" />

          <section aria-label="热招方向">
            <div className="flex items-center gap-3">
              <h4 className="kicker shrink-0 text-[10px] text-muted-foreground">热招方向</h4>
              <span aria-hidden className="h-px flex-1 bg-border/60" />
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {positions.map((p) => (
                <span
                  key={p}
                  className="rounded-[4px] border border-border bg-secondary/60 px-2 py-1 text-[12px] leading-5"
                >
                  {p}
                </span>
              ))}
            </div>
          </section>

          <section aria-label="信息来源" className="mt-5">
            <div className="flex items-center gap-3">
              <h4 className="kicker shrink-0 text-[10px] text-muted-foreground">信息来源</h4>
              <span aria-hidden className="h-px flex-1 bg-border/60" />
            </div>
            <p className="mt-2.5 text-[12.5px] leading-relaxed tabular-nums text-muted-foreground">
              {company.sourceType}「{company.sourceName}」 · {company.publishedDay ? dateLabel(company.publishedDay) : "日期待核"}
              {company.publishedDay ? `（${weekdayLabel(company.publishedDay)}）放出` : ""}
            </p>
          </section>

          {appList.length > 0 && (
            <section aria-label="投递轨迹" className="mt-5">
              <div className="flex items-center gap-3">
                <h4 className="kicker shrink-0 text-[10px] text-muted-foreground">
                  投递轨迹{appList.length > 1 ? ` · ${appList.length} 条记录` : ` · ${appList[0].status}`}
                </h4>
                <span aria-hidden className="h-px flex-1 bg-border/60" />
                {appList.length === 1 && (
                  <DeleteAppButton
                    label={`删除「${appList[0].position}」的投递记录`}
                    onClick={() => setPendingDeleteApp(appList[0])}
                  />
                )}
              </div>
              {appList.map((app, idx) => (
                <div
                  key={app.id}
                  className={cn(
                    idx > 0 && "mt-4 border-t border-border/50 pt-4",
                    idx === 0 && appList.length > 1 && "mt-2.5"
                  )}
                >
                  {appList.length > 1 && (
                    <p className="mt-3 flex items-center gap-2 text-[12.5px] font-medium">
                      <span
                        aria-hidden
                        className={cn("size-1.5 rounded-full", STATUS_DOT[app.status] ?? "bg-stone-400")}
                      />
                      <span className="truncate">{app.position}</span>
                      <span className="shrink-0 text-[11px] font-normal text-muted-foreground">{app.status}</span>
                      <DeleteAppButton
                        label={`删除「${app.position}」的投递记录`}
                        onClick={() => setPendingDeleteApp(app)}
                        className="ml-auto"
                      />
                    </p>
                  )}
                  <ol className={cn(appList.length > 1 ? "mt-2.5" : "mt-3")}>
                    {app.history.map((h, i) => {
                      const day = toShanghaiDateStr(h.at)
                      const isLatest = i === app.history.length - 1
                      return (
                        <li key={`${h.at}-${i}`} className="relative flex gap-3 pb-3.5 last:pb-0">
                          {/* 轴点与连线 */}
                          <span aria-hidden className="flex flex-col items-center">
                            <span
                              className={cn(
                                "mt-[5px] size-1.5 shrink-0 rounded-full",
                                STATUS_DOT[h.status] ?? "bg-stone-400",
                                !isLatest && "opacity-55"
                              )}
                            />
                            {!isLatest && <span className="my-0.5 w-px flex-1 bg-border/70" />}
                          </span>
                          <span className="min-w-0 flex-1 pb-0.5">
                            <span
                              className={cn(
                                "flex items-baseline gap-2",
                                isLatest ? "text-[12.5px] font-medium text-foreground" : "text-[12px] text-muted-foreground"
                              )}
                            >
                              {h.status}
                              {isLatest && (
                                <span className="rounded-full border border-primary/25 bg-accent px-1.5 py-px text-[10px] font-normal text-accent-foreground">
                                  当前
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 block text-[10.5px] tabular-nums text-muted-foreground/80">
                              {dateLabel(day)} {timeFmt.format(new Date(h.at))}
                            </span>
                          </span>
                        </li>
                      )
                    })}
                  </ol>
                  {/* 面试笔记：随这条岗位记录走，投递看板删记录时一并删除 */}
                  <NoteEditor app={app} onSave={onUpdateNotes} />
                </div>
              ))}
            </section>
          )}

          <div className="mt-7 flex flex-col gap-2.5">
            <Button
              className="h-10 rounded-md text-[13.5px]"
              onClick={() => {
                onApply(company)
                onClose()
              }}
            >
              <Check className="mr-1.5 size-4" strokeWidth={1.8} />
              {appList.length > 0 ? `记投递 · 已有 ${appList.length} 条记录` : "记一笔投递"}
            </Button>
            <div className="flex gap-2.5">
              {company.recruitUrl ? (
                <Button variant="outline" className="h-10 flex-1 rounded-md text-[13.5px]" asChild>
                  <a href={company.recruitUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-1.5 size-4" strokeWidth={1.6} />
                    前往招聘官网
                  </a>
                </Button>
              ) : (
                <Button
                  variant="outline"
                  disabled
                  title="暂无官网链接，可搜索企业名投递"
                  className="h-10 flex-1 rounded-md text-[13.5px]"
                >
                  <ExternalLink className="mr-1.5 size-4" strokeWidth={1.6} />
                  暂无官网链接
                </Button>
              )}
              <Button
                variant="outline"
                aria-label="复制企业简介"
                className="h-10 w-10 rounded-md p-0"
                onClick={async () => {
                  await navigator.clipboard.writeText(`${company.name}｜${company.summary}\n${desc}`)
                  toast.success("简介已复制")
                }}
              >
                <Copy className="size-4" strokeWidth={1.6} />
              </Button>
            </div>
          </div>

          <p className="mt-6 border-t border-border/60 pt-4 text-center text-[11px] leading-relaxed text-muted-foreground/70">
            投递前请以企业招聘官网的最新岗位与流程为准
          </p>

          {/* 同行业推荐：延续「先企业后岗位」的浏览动线，不关侧滑直接跳看 */}
          {(similar === null || similar.length > 0) && (
            <section aria-label="同行业更多企业" className="mt-6">
              <div className="flex items-center gap-3">
                <h4 className="kicker shrink-0 text-[10px] text-muted-foreground">
                  同行业 · 继续看
                </h4>
                <span aria-hidden className="h-px flex-1 bg-border/60" />
              </div>
              {similar === null ? (
                <div className="mt-3 space-y-2">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-md border border-border/70 px-3 py-2.5">
                      <Skeleton className="size-8 rounded-[6px]" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-2.5 w-40" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 space-y-1.5">
                  {similar.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => onOpenCompany(s)}
                      className="group flex w-full items-center gap-3 rounded-md border border-border/70 bg-card px-3 py-2.5 text-left transition-colors hover:border-foreground/25 hover:bg-secondary/40"
                    >
                      <CompanyAvatar
                        name={s.name}
                        industry={s.industry}
                        className="size-8 shrink-0 rounded-[6px] text-[13px]"
                        logoDomain={domainFromUrl(s.recruitUrl)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="font-display truncate text-[13px] font-semibold tracking-wide">
                            {s.name}
                          </span>
                          {s.application && (
                            <span
                              aria-hidden
                              className={cn(
                                "size-1.5 shrink-0 rounded-full",
                                STATUS_DOT[s.application.status] ?? "bg-stone-400"
                              )}
                            />
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                          {s.summary}
                        </span>
                      </span>
                      <span
                        aria-hidden
                        className="shrink-0 text-[11px] text-muted-foreground/70 transition-colors group-hover:text-foreground"
                      >
                        查看
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </SheetContent>

      {/* 删除单条投递记录：与轨迹同层确认，避免误触（企业本体不受影响） */}
      <AlertDialog open={!!pendingDeleteApp} onOpenChange={(open) => !open && setPendingDeleteApp(null)}>
        <AlertDialogContent className="rounded-lg sm:max-w-[400px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-base tracking-wide">
              删除「{pendingDeleteApp?.company?.name} · {pendingDeleteApp?.position}」的记录？
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[12.5px]">
              这条岗位的投递记录与流转轨迹将一并删除；名录中的企业不受影响，之后可以重新记录。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-md text-[13px]">保留</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-md bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (pendingDeleteApp) onDeleteApp(pendingDeleteApp)
                setPendingDeleteApp(null)
              }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  )
}
