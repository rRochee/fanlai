"use client"

import { ArrowUpRight, Pin, Star } from "lucide-react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import { splitList, STATUS_DOT, type Company } from "@/lib/types"
import { CompanyDeadlineChip, DeadlineChip } from "@/lib/deadline"
import { domainFromUrl } from "@/lib/logo"
import { CompanyAvatar } from "./company-avatar"
import { Button } from "@/components/ui/button"

/** 列表/卡片用的简介摘要：AI 情报条目剥掉模板壳只留核心摘要，其余原样返回 */
export function briefDescription(raw: string | null | undefined, fallback = ""): string {
  if (!raw) return fallback
  if (raw.startsWith("本条由饭来 AI 情报通道")) return raw.match(/摘要：(.+?)(?:。|$)/)?.[1] ?? fallback
  return raw
}

/** 名录行：今日视图与列表模式共用（整行可点查看详情）；传入 onPin 时（清单）提供置顶操作 */
export function CompanyRow({
  company,
  onDetail,
  onApply,
  onStar,
  onPin,
}: {
  company: Company
  onDetail: (c: Company) => void
  onApply: (c: Company) => void
  onStar: (c: Company) => void
  onPin?: (c: Company) => void
}) {
  const positions = splitList(company.positions).slice(0, 3)
  const applied = company.application
  const appCount = company.applicationCount ?? (applied ? 1 : 0)
  const brief = briefDescription(company.description)
  const showBrief = brief && brief !== company.summary

  return (
    <article
      onClick={() => onDetail(company)}
      className="group relative flex cursor-pointer gap-4 border-b border-border/70 px-4 py-4 transition-colors last:border-b-0 hover:bg-gradient-to-r hover:from-secondary/70 hover:to-transparent sm:px-5 sm:py-5"
    >
      {/* hover 声部色条：从中心展开的印刷标记（今日=绯红） */}
      <span aria-hidden className="row-mark bg-[color:var(--crimson)]" />
      <CompanyAvatar
        name={company.name}
        industry={company.industry}
        className="transition-transform duration-300 group-hover:scale-[1.06]"
        logoDomain={domainFromUrl(company.recruitUrl)}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <h3 className="font-display text-[17px] font-bold tracking-wide transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-[color:var(--navy-block)] dark:group-hover:text-white">
            {company.name}
          </h3>
          <span className="text-[12.5px] text-muted-foreground">
            {company.industry}
            {/* 城市「待核」时省略，避免「行业 · 待核」的无效信息 */}
            {company.city && company.city !== "待核" && ` · ${company.city}`}
            {company.size !== "待核" && ` · ${company.size}`}
          </span>
          {/* 企业秋招网申截止（绯红描边风，与下方投递记录 DDL 区分） */}
          <CompanyDeadlineChip deadline={company.deadline} />
          {applied && (
            <span className="flex items-center gap-1 rounded-full border border-primary/25 bg-accent px-2 py-px text-[11px] font-medium text-accent-foreground">
              <span aria-hidden className={cn("size-1 rounded-full", STATUS_DOT[applied.status] ?? "bg-stone-400")} />
              {appCount > 1 ? `已记录 ${appCount} 个岗位` : `已记录 · ${applied.status}`}
            </span>
          )}
          {applied?.deadline && <DeadlineChip deadline={applied.deadline} />}
          {company.hidden && (
            <span className="rounded-full border border-border/90 bg-secondary/70 px-2 py-px text-[11px] text-muted-foreground">
              已忽略
            </span>
          )}
          {company.pinned && (
            <span className="flex items-center gap-1 rounded-full border border-primary/25 bg-accent px-2 py-px text-[11px] font-medium text-accent-foreground">
              <Pin aria-hidden className="size-2.5" strokeWidth={2} />
              置顶
            </span>
          )}
          {!company.verified && (
            <span className="sticker-tag-r rounded-[2px] border border-[color:var(--crimson)]/45 bg-[color:var(--crimson-soft)] px-1.5 py-px text-[10.5px] font-medium tracking-wide text-[color:var(--crimson-deep)]">
              AI 情报 · 待核
            </span>
          )}
        </div>

        <p className="mt-1 line-clamp-1 text-[14px] leading-relaxed text-foreground/85">
          {company.summary}
        </p>
        {showBrief && (
          <p className="mt-1 line-clamp-2 text-[13px] leading-[1.7] text-muted-foreground">
            {brief}
          </p>
        )}

        <div className="mt-2 hidden flex-wrap items-center gap-1.5 sm:flex">
          {positions.map((p) => (
            <span
              key={p}
              className="rounded-[4px] border border-border/80 bg-background px-1.5 py-0.5 text-[11.5px] text-foreground/80"
            >
              {p}
            </span>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end justify-between gap-2">
        <div className="flex items-center gap-0.5">
          {onPin && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onPin(company)
              }}
              aria-label={company.pinned ? "取消置顶" : "置顶该企业"}
              title={company.pinned ? "取消置顶" : "置顶（排在清单最前）"}
              className={cn(
                "flex size-7 items-center justify-center rounded-md transition-colors",
                company.pinned
                  ? "text-primary hover:bg-accent"
                  : "text-muted-foreground/75 hover:bg-secondary hover:text-foreground"
              )}
            >
              <motion.span
                key={company.pinned ? "pin-on" : "pin-off"}
                initial={{ scale: company.pinned ? 0.4 : 1 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 520, damping: 16 }}
                className="flex"
              >
                <Pin className={cn("size-[15px]", company.pinned && "fill-primary")} strokeWidth={1.6} />
              </motion.span>
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onStar(company)
            }}
            aria-label={company.starred ? "取消星标" : "加入星标"}
            title={company.starred ? "取消星标" : "加入星标，进清单跟进"}
            className={cn(
              "flex size-7 items-center justify-center rounded-md transition-colors",
              company.starred
                ? "text-primary hover:bg-accent"
                : "text-muted-foreground/75 hover:bg-secondary hover:text-foreground"
            )}
          >
            {/* 星标弹跳：点亮的瞬间 pop 一下，让「想吃这家」有手感 */}
            <motion.span
              key={company.starred ? "star-on" : "star-off"}
              initial={{ scale: company.starred ? 0.4 : 1, rotate: company.starred ? -18 : 0 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 520, damping: 16 }}
              className="flex"
            >
              <Star className={cn("size-[15px]", company.starred && "fill-primary")} strokeWidth={1.6} />
            </motion.span>
          </button>
          {company.recruitUrl ? (
            <a
              href={company.recruitUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              aria-label={`打开${company.name}招聘官网`}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-secondary hover:text-foreground"
            >
              <ArrowUpRight className="size-[15px]" strokeWidth={1.6} />
            </a>
          ) : (
            <span
              aria-hidden
              title="暂无官网链接，可搜索企业名投递"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground/35"
            >
              <ArrowUpRight className="size-[15px]" strokeWidth={1.6} />
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="hidden h-8 rounded-md px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground sm:inline-flex"
          onClick={(e) => {
            e.stopPropagation()
            onApply(company)
          }}
        >
          {applied ? (appCount > 1 ? "记投递" : "更新投递") : "记一笔投递"}
        </Button>
      </div>
    </article>
  )
}
