"use client"

import Image from "next/image"
import { Download, Star } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { toShanghaiDateStr } from "@/lib/date"
import { type Company, type CompaniesResponse } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { CompanyRow } from "./company-row"
import { Bowl } from "./bowl"
import { ViewBanner } from "./view-banner"

/**
 * 我的清单：星标企业一页式跟进。
 * 分三组呈现——投递进行中 / 暂告段落 / 待投递；组内置顶优先，支持导出清单 CSV。
 */
export function ShortlistView({
  data,
  loading,
  onDetail,
  onApply,
  onStar,
  onPin,
  onGoDirectory,
}: {
  data: CompaniesResponse | null
  loading: boolean
  onDetail: (c: Company) => void
  onApply: (c: Company) => void
  onStar: (c: Company) => void
  onPin: (c: Company) => void
  onGoDirectory: () => void
}) {
  const items = data?.items ?? []

  const withApp = items.filter((c) => c.application)
  const active = withApp
    .filter((c) => c.application!.status !== "暂告段落")
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      const da = a.application?.deadline ? new Date(a.application.deadline).getTime() : Number.POSITIVE_INFINITY
      const db = b.application?.deadline ? new Date(b.application.deadline).getTime() : Number.POSITIVE_INFINITY
      if (da !== db) return da - db
      return a.name.localeCompare(b.name, "zh")
    })
  const paused = withApp
    .filter((c) => c.application!.status === "暂告段落")
    .sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : a.name.localeCompare(b.name, "zh")))
  const pending = items
    .filter((c) => !c.application)
    .sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : a.publishedDay < b.publishedDay ? 1 : -1))

  const groups: { key: string; title: string; hint: string; list: Company[] }[] = [
    { key: "active", title: "投递进行中", hint: "置顶优先 · 按最近截止日", list: active },
    { key: "paused", title: "暂告段落", hint: "流程已结束的记录", list: paused },
    { key: "pending", title: "待投递", hint: "星标了但还没记投递的企业", list: pending },
  ]

  function exportCsv() {
    if (items.length === 0) return
    const header = ["企业", "行业", "城市", "投递状态", "岗位", "截止日", "放出日", "招聘官网"]
    const rows = items.map((c) => [
      c.name,
      c.industry,
      c.city,
      c.application?.status ?? "待投递",
      c.application?.position ?? "",
      c.application?.deadline ? toShanghaiDateStr(c.application.deadline) : "",
      c.publishedDay,
      c.recruitUrl,
    ])
    const csv =
      "\uFEFF" +
      [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "饭来·我的清单.csv"
    a.click()
    URL.revokeObjectURL(url)
    toast.success("已导出清单 CSV，可直接用表格软件打开")
  }

  const total = items.length

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-foreground/15 pb-8 pt-10 sm:pb-10 sm:pt-14">
        <div>
          <p className="kicker text-[10.5px] text-[color:var(--powder)]">My Shortlist</p>
          <h1 className="font-display mt-2.5 flex items-baseline gap-3 text-[30px] font-bold tracking-wide sm:text-[36px]">
            <span aria-hidden className="section-no text-[28px] font-semibold sm:text-[32px]">03</span>
            我的清单
          </h1>
          <p className="mt-2.5 max-w-lg text-[13px] leading-relaxed text-muted-foreground">
            星标过的企业都在这里，一眼看清每家投到哪一步、下一个节点是什么时候。
          </p>
        </div>
        <Button
          variant="outline"
          className="h-9 rounded-md text-[12.5px]"
          onClick={exportCsv}
          disabled={total === 0}
        >
          <Download className="mr-1.5 size-4" strokeWidth={1.6} />
          导出清单 CSV
        </Button>
      </div>

      {/* 清晨山谷横幅：清单的性格页——意向收在碗里，心是定的 */}
      {total > 0 && (
        <ViewBanner
          src="/images/scenery-valley.jpg"
          alt="清晨开阔的山谷草原"
          kicker="MY SHORTLIST"
          title="你的意向清单，稳稳收在碗里"
          note={`共 ${total} 家星标 · 待投递 ${pending.length} 家`}
          tone="light"
          priority
          className="mt-6 h-40 sm:h-44"
        />
      )}

      {loading && !data ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-secondary/60" />
          ))}
        </div>
      ) : total === 0 ? (
        // 空态：清晨山谷小图卡——空碗也有一幅好风景
        <div className="mx-auto max-w-md overflow-hidden rounded-xl border border-border/80 bg-card">
          <div className="cover-img relative aspect-[21/9]">
            <Image
              src="/images/hero-scenery.jpg"
              alt="清晨的山谷草原"
              fill
              sizes="(max-width: 640px) 100vw, 448px"
              className="object-cover"
            />
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-white/75 via-white/10 to-transparent dark:from-[#0c2340]/75 dark:via-[#0c2340]/10"
            />
            <p className="absolute bottom-2.5 left-4 font-display text-[12.5px] tracking-wide text-[#0c2340] dark:text-white">
              山谷已备好，等你放第一颗星
            </p>
          </div>
          <div className="flex flex-col items-center gap-2.5 px-6 py-7 text-center">
            <Bowl mood="idle" size={44} />
            <p className="font-display text-[15px] text-foreground/70">饭单还是空的</p>
            <p className="max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">
              在今日名录、企业名录或详情侧滑里点星标，心仪的企业就会汇集到这里跟进
            </p>
            <Button variant="outline" className="mt-1 h-9 rounded-md text-[13px]" onClick={onGoDirectory}>
              去企业名录逛逛
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {groups
            .filter((g) => g.list.length > 0)
            .map((g) => (
              <section key={g.key} aria-label={g.title}>
                <div className="flex items-baseline gap-2.5 px-1 pb-2">
                  <h2 className="text-[13px] font-medium tracking-wide">{g.title}</h2>
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[10.5px] leading-4 tabular-nums",
                      g.list.length > 0 ? "bg-secondary/80 text-muted-foreground" : "text-muted-foreground/70"
                    )}
                  >
                    {g.list.length}
                  </span>
                  <span aria-hidden className="h-px flex-1 self-center bg-border/60" />
                  <span className="shrink-0 text-[10.5px] text-muted-foreground/75">{g.hint}</span>
                </div>
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                  {g.list.map((c, i) => (
                    <ShortlistItemWrapper key={c.id} first={i === 0}>
                      <CompanyRow company={c} onDetail={onDetail} onApply={onApply} onStar={onStar} onPin={onPin} />
                    </ShortlistItemWrapper>
                  ))}
                </div>
              </section>
            ))}
          <p className="text-center text-[11px] leading-relaxed text-muted-foreground/80">
            置顶的企业会排在每组最前；取消星标后企业会从清单移除，名录与今日批次不受影响
          </p>
        </div>
      )}
    </div>
  )
}

/** 组内首行去掉上边框（CompanyRow 自带 border-b） */
function ShortlistItemWrapper({ first, children }: { first: boolean; children: React.ReactNode }) {
  return <div className={cn(!first && "border-t border-border/70")}>{children}</div>
}
