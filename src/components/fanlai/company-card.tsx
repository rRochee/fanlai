"use client"

import Image from "next/image"
import { ArrowUpRight, Star } from "lucide-react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import { splitList, STATUS_DOT, type Company } from "@/lib/types"
import { CompanyDeadlineChip, DeadlineChip } from "@/lib/deadline"
import { INDUSTRY_COVER } from "@/lib/catalog"
import { dateLabel } from "@/lib/date"
import { domainFromUrl } from "@/lib/logo"
import { CompanyAvatar } from "./company-avatar"
import { briefDescription } from "./company-row"

/** 名录卡片（网格模式）：带行业封面配图 */
export function CompanyCard({
  company,
  onDetail,
  onStar,
}: {
  company: Company
  onDetail: (c: Company) => void
  onStar: (c: Company) => void
}) {
  const cover = INDUSTRY_COVER[company.industry as keyof typeof INDUSTRY_COVER]
  const positions = splitList(company.positions)
  const brief = briefDescription(company.description)
  const showBrief = brief && brief !== company.summary

  return (
    <article
      onClick={() => onDetail(company)}
      className="flex cursor-pointer flex-col overflow-hidden rounded-lg border border-border bg-card transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-[0_2px_12px_rgba(32,29,25,0.06)] dark:hover:border-[#4a473f] dark:hover:shadow-[0_2px_16px_rgba(0,0,0,0.45)]"
    >
      <div
        className="relative aspect-[16/9] overflow-hidden border-b border-border"
        role="button"
        aria-label={`查看${company.name}详情`}
      >
        {cover && (
          <Image
            src={cover}
            alt={`${company.industry}行业示意插画`}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw"
            className="art-img object-cover"
          />
        )}
        <span className="absolute left-3 top-3 rounded-full bg-background/85 px-2.5 py-1 text-[10.5px] font-medium text-foreground/80 backdrop-blur-sm">
          {company.industry}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onStar(company)
          }}
          aria-label={company.starred ? "取消星标" : "加入星标"}
          className={cn(
            "absolute right-3 top-3 z-20 flex size-7 items-center justify-center rounded-full bg-background/85 backdrop-blur-sm transition-colors",
            company.starred ? "text-primary" : "text-muted-foreground/80 hover:text-foreground"
          )}
        >
          <motion.span
            key={company.starred ? "on" : "off"}
            initial={{ scale: company.starred ? 0.4 : 1, rotate: company.starred ? -18 : 0 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 520, damping: 16 }}
            className="flex"
          >
            <Star className={cn("size-[14px]", company.starred && "fill-primary")} strokeWidth={1.6} />
          </motion.span>
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <CompanyAvatar
              name={company.name}
              industry={company.industry}
              className="size-8 rounded-[8px] text-[14px]"
              logoDomain={domainFromUrl(company.recruitUrl)}
            />
            <h3 className="font-display truncate text-[16.5px] font-bold tracking-wide">{company.name}</h3>
          </div>
          {company.recruitUrl ? (
            <a
              href={company.recruitUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`打开${company.name}招聘官网`}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-secondary hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              <ArrowUpRight className="size-[14px]" strokeWidth={1.6} />
            </a>
          ) : (
            <span
              aria-hidden
              title="暂无官网链接，可搜索企业名投递"
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/35"
            >
              <ArrowUpRight className="size-[14px]" strokeWidth={1.6} />
            </span>
          )}
        </div>
        <p className="line-clamp-2 min-h-9 text-[13.5px] leading-relaxed text-foreground/85">
          {company.summary}
        </p>
        {showBrief && (
          <p className="line-clamp-3 text-[13px] leading-[1.7] text-muted-foreground">{brief}</p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1.5 text-[12px] text-muted-foreground">
          {/* 城市「待核」时省略，避免卡片 meta 出现无效地名 */}
          {company.city && company.city !== "待核" && <span>{company.city}</span>}
          {company.city && company.city !== "待核" && company.size !== "待核" && (
            <span className="text-border">|</span>
          )}
          {company.size !== "待核" && <span>{company.size}</span>}
          {positions[0] && (
            <>
              <span className="text-border">|</span>
              <span className="text-foreground/60">{positions[0]}</span>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-[10.5px] tabular-nums text-muted-foreground/80">{dateLabel(company.publishedDay)} 放出</span>
          <CompanyDeadlineChip deadline={company.deadline} />
          {company.application && (
            <span className="flex items-center gap-1 rounded-full border border-primary/25 bg-accent px-2 py-px text-[10.5px] font-medium text-accent-foreground">
              <span aria-hidden className={cn("size-1 rounded-full", STATUS_DOT[company.application.status] ?? "bg-stone-400")} />
              {company.application.status}
            </span>
          )}
          {company.application?.deadline && <DeadlineChip deadline={company.application.deadline} />}
          {company.hidden && (
            <span className="rounded-full border border-border/90 bg-secondary/70 px-2 py-px text-[10.5px] text-muted-foreground">
              已忽略
            </span>
          )}
        </div>
      </div>
    </article>
  )
}
