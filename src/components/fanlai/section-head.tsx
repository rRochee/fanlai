import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

/**
 * 编辑风分节标题（杂志栏目序号感）：
 * [01] 今日送达 —— TODAY'S SERVE ——————————— (right)
 * 绯红斜体大编号 + 衬线大标 + letterspaced 英文小标 + 细规线 + 右侧插槽
 */
export function SectionHead({
  no,
  title,
  en,
  right,
  className,
}: {
  no: string
  title: ReactNode
  en: string
  right?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3.5 gap-y-1", className)}>
      <span aria-hidden className="section-no font-display text-[30px] font-semibold leading-none tabular-nums">
        {no}
      </span>
      <h2 className="font-display text-[23px] font-bold leading-none tracking-wide">{title}</h2>
      <span aria-hidden className="kicker hidden text-[10px] leading-none text-muted-foreground/80 sm:inline">
        {en}
      </span>
      <span aria-hidden className="h-px min-w-6 flex-1 bg-foreground/15" />
      {right}
    </div>
  )
}
