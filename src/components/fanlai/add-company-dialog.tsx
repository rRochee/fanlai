"use client"

import { useEffect, useState } from "react"
import { Check, Plus } from "lucide-react"
import { api, SEASONS, type Season } from "@/lib/types"
import { FOCUS_INDUSTRIES, INDUSTRIES, type Industry } from "@/lib/catalog"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

const ORDERED_INDUSTRIES: Industry[] = [
  ...FOCUS_INDUSTRIES,
  ...INDUSTRIES.filter((i) => !FOCUS_INDUSTRIES.includes(i)),
]

const fieldCls =
  "h-9 rounded-md border-input bg-card text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
const labelCls = "kicker text-[10px] text-muted-foreground"
const hintCls = "mt-1 text-[10.5px] leading-relaxed text-muted-foreground/80"

/** 手动补充企业：名录遗漏时的兜底入口，录入后立即进入已核目录与今日批次 */
export function AddCompanyDialog({
  open,
  onOpenChange,
  season,
  onAdded,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  season: Season
  onAdded: (name: string) => void
}) {
  const [name, setName] = useState("")
  const [industry, setIndustry] = useState<Industry | "">(FOCUS_INDUSTRIES[0])
  const [city, setCity] = useState("")
  const [summary, setSummary] = useState("")
  const [positions, setPositions] = useState("")
  const [recruitUrl, setRecruitUrl] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 关闭时回到干净起始态
  useEffect(() => {
    if (!open) {
      setName("")
      setIndustry(FOCUS_INDUSTRIES[0])
      setCity("")
      setSummary("")
      setPositions("")
      setRecruitUrl("")
      setError(null)
    }
  }, [open])

  const valid = name.trim().length > 0 && industry && summary.trim().length > 0

  async function submit() {
    if (!valid || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await api<{ message: string }>("/api/companies", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          industry,
          city: city.trim(),
          summary: summary.trim(),
          positions: positions.trim(),
          recruitUrl: recruitUrl.trim(),
          season,
        }),
      })
      onAdded(name.trim())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-lg p-0 sm:max-w-[520px]">
        <DialogHeader className="border-b border-border/70 px-5 pb-3.5 pt-5">
          <DialogTitle className="font-display text-[15px] tracking-wide">补充企业</DialogTitle>
          <DialogDescription className="text-[12px] leading-relaxed">
            发现名录漏掉了某家企业？直接录入，立即进入{season}已核目录与今日批次
          </DialogDescription>
        </DialogHeader>

        <form
          className="px-5 pb-5 pt-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="grid gap-3.5 sm:grid-cols-2">
            {/* 企业名 */}
            <div>
              <label htmlFor="ac-name" className={labelCls}>
                企业名 *
              </label>
              <Input
                id="ac-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：大疆创新"
                maxLength={30}
                className={cn(fieldCls, "mt-1.5")}
              />
            </div>
            {/* 城市 */}
            <div>
              <label htmlFor="ac-city" className={labelCls}>
                主要城市
              </label>
              <Input
                id="ac-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="如：深圳（可不填）"
                maxLength={20}
                className={cn(fieldCls, "mt-1.5")}
              />
            </div>
          </div>

          {/* 行业 */}
          <div className="mt-3.5">
            <p className={labelCls} id="ac-industry-label">
              行业 *
            </p>
            <div
              role="radiogroup"
              aria-labelledby="ac-industry-label"
              className="no-scrollbar mt-1.5 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto scroll-thin"
            >
              {ORDERED_INDUSTRIES.map((ind) => {
                const active = industry === ind
                return (
                  <button
                    key={ind}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setIndustry(ind)}
                    className={cn(
                      "rounded-[4px] border px-2 py-1 text-[11.5px] transition-colors",
                      active
                        ? "border-primary/45 bg-accent font-medium text-primary"
                        : "border-border/80 bg-card text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {ind}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 一句话简介 */}
          <div className="mt-3.5">
            <label htmlFor="ac-summary" className={labelCls}>
              一句话简介 *
            </label>
            <Input
              id="ac-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="它做什么、为什么值得投（40 字内）"
              maxLength={40}
              className={cn(fieldCls, "mt-1.5")}
            />
          </div>

          <div className="mt-3.5 grid gap-3.5 sm:grid-cols-2">
            {/* 热招方向 */}
            <div>
              <label htmlFor="ac-positions" className={labelCls}>
                热招方向
              </label>
              <Input
                id="ac-positions"
                value={positions}
                onChange={(e) => setPositions(e.target.value)}
                placeholder="管培生, 算法工程师（可选）"
                className={cn(fieldCls, "mt-1.5")}
              />
            </div>
            {/* 招聘官网 */}
            <div>
              <label htmlFor="ac-url" className={labelCls}>
                招聘官网
              </label>
              <Input
                id="ac-url"
                value={recruitUrl}
                onChange={(e) => setRecruitUrl(e.target.value)}
                placeholder="https://…（可不填）"
                className={cn(fieldCls, "mt-1.5")}
              />
              <p className={hintCls}>不填时自动挂搜索链接，仍可一键找到官网</p>
            </div>
          </div>

          {error && (
            <p role="alert" className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
              {error}
            </p>
          )}

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-[10.5px] leading-relaxed text-muted-foreground/80">
              录入即视为已核实（标注「本人录入」），可随时在详情里补充
            </p>
            <button
              type="submit"
              disabled={!valid || submitting}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-md px-4 py-2 text-[12.5px] font-medium transition-colors",
                valid && !submitting
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "cursor-not-allowed bg-secondary text-muted-foreground/80"
              )}
            >
              {submitting ? <Plus className="size-3.5 animate-spin" strokeWidth={2} /> : <Check className="size-3.5" strokeWidth={2} />}
              {submitting ? "录入中…" : "录入名录"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
