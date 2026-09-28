"use client"

import { cn } from "@/lib/utils"
import { toShanghaiDateStr } from "@/lib/date"

/**
 * 官网核验徽标（Task 27-a 核验管道的前端可见化 · 杂志脚注风，极小不喧宾夺主）：
 * - urlStatus === "ok"   → 青绿小点 + 「官网已核验」（title 带核验日期）
 * - urlStatus === "soft" → 灰点 + 「官网可达」（反爬或跳转，浏览器一般可打开）
 * - "fail" / null        → 不渲染（fail 场景在详情侧滑内用灰色提示语表达）
 */
export function UrlVerifyBadge({
  urlStatus,
  urlCheckedAt,
  className,
}: {
  urlStatus: "ok" | "soft" | "fail" | null | undefined
  urlCheckedAt: string | null | undefined
  className?: string
}) {
  if (urlStatus !== "ok" && urlStatus !== "soft") return null
  const ok = urlStatus === "ok"
  const day = urlCheckedAt ? toShanghaiDateStr(urlCheckedAt) : null
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 t-data text-[12px] leading-4",
        ok ? "text-[color:var(--teal)]" : "text-muted-foreground/75",
        className
      )}
      title={
        day
          ? ok
            ? `招聘官网已机器核验可达 · ${day}`
            : `官网可达（对方反爬或跳转）· 核验于 ${day}`
          : ok
            ? "招聘官网已机器核验可达"
            : "官网可达（对方反爬或跳转）"
      }
    >
      <span
        aria-hidden
        className={cn("size-[5px] shrink-0 rounded-full", !ok && "bg-muted-foreground/45")}
        style={ok ? { background: "var(--teal)" } : undefined}
      />
      {ok ? "官网已核验" : "官网可达"}
    </span>
  )
}

/** 便捷包装：直接吃 Company（fields urlStatus / urlCheckedAt 为可选，兼容旧数据） */
export function CompanyUrlBadge({
  company,
  className,
}: {
  company: { urlStatus?: "ok" | "soft" | "fail" | null; urlCheckedAt?: string | null }
  className?: string
}) {
  return <UrlVerifyBadge urlStatus={company.urlStatus} urlCheckedAt={company.urlCheckedAt} className={className} />
}
