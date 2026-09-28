"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { INDUSTRIES } from "@/lib/catalog"
import type { SessionUser } from "@/lib/session"

/**
 * 「定制我的饭来bot」弹窗 —— 昵称 / 头像 emoji / 目标行业 / 每日推送时间 / 推送渠道。
 * 保存走 PUT /api/me；主控可在初次登录（onboarded=false）时用它做 onboarding 引导，
 * 保存时随 payload 一并置 onboarded=true（服务端已支持该字段）。
 */

// 头像候选 emoji
const AVATARS = ["🍚", "🍜", "🍱", "🥟", "🍙", "🍵", "🔥", "🎯", "🌟", "💪", "🧭", "🌱"]

// 每日推送时间档位
const PUSH_OPTIONS = [
  { value: "08:00", label: "早晨快报", desc: "睁眼第一碗，看今天新放出谁" },
  { value: "12:00", label: "午间加餐", desc: "午休刷一刷，别错过上午的新菜" },
  { value: "20:00", label: "晚间放榜", desc: "晚饭后慢慢看，想好明天投什么" },
] as const

// 小节刊号（杂志小节风格）
function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] uppercase tracking-[0.28em] text-foreground/70">
      {children}
    </p>
  )
}

export function CustomizeDialog({
  open,
  onOpenChange,
  user,
  onSaved,
  onLogout,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: SessionUser | null
  onSaved: (user: SessionUser) => void
  onLogout?: () => void
}) {
  const [name, setName] = useState("")
  const [avatar, setAvatar] = useState("🍚")
  const [industries, setIndustries] = useState<string[]>([])
  const [pushTime, setPushTime] = useState("08:00")
  const [channelEmail, setChannelEmail] = useState(true)
  const [channelWechat, setChannelWechat] = useState(false)
  const [saving, setSaving] = useState(false)

  // 打开弹窗时，用当前用户回填表单
  useEffect(() => {
    if (open && user) {
      setName(user.name)
      setAvatar(user.avatar)
      setIndustries(user.industries)
      setPushTime(user.pushTime)
      setChannelEmail(user.channelEmail)
      setChannelWechat(user.channelWechat)
    }
  }, [open, user])

  const toggleIndustry = (ind: string) =>
    setIndustries((list) =>
      list.includes(ind) ? list.filter((s) => s !== ind) : [...list, ind]
    )

  // 保存：PUT /api/me（onboarded 一并置 true，主控的 onboarding 引导据此不再弹出）
  const save = async () => {
    if (saving) return
    if (name.trim().length < 1) {
      toast.error("昵称至少要有 1 个字")
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          avatar,
          industries,
          pushTime,
          channelEmail,
          channelWechat,
          onboarded: true,
        }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) {
        toast.success("已保存，饭来按你的口味开饭")
        onSaved(data.user as SessionUser)
        onOpenChange(false)
      } else {
        toast.error(data?.error ?? "保存失败，稍后再试")
      }
    } catch {
      toast.error("网络不太顺，稍后再试一次")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88svh] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-masthead text-2xl font-black tracking-wide">
            定制我的饭来bot
          </DialogTitle>
          <DialogDescription>让每天的情报更合口味</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* 01 昵称 */}
          <div className="space-y-2.5">
            <div className="flex items-baseline justify-between">
              <Kicker>01 · 昵称</Kicker>
              <span className="text-[11px] text-muted-foreground">{name.length}/20</span>
            </div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 20))}
              maxLength={20}
              placeholder="想让大家怎么叫你"
              className="h-11"
            />
          </div>

          {/* 02 头像 */}
          <div className="space-y-2.5">
            <Kicker>02 · 头像</Kicker>
            <div className="flex flex-wrap gap-2">
              {AVATARS.map((emo) => {
                const on = avatar === emo
                return (
                  <button
                    key={emo}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setAvatar(emo)}
                    className={`flex size-11 items-center justify-center rounded-full border text-xl transition-colors ${
                      on
                        ? "border-[var(--crimson)] ring-2 ring-[var(--crimson)]/30"
                        : "border-border hover:border-foreground/40"
                    }`}
                  >
                    {emo}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 03 目标行业 */}
          <div className="space-y-2.5">
            <div className="flex items-baseline justify-between">
              <Kicker>03 · 目标行业</Kicker>
              <span className="text-[11px] text-muted-foreground">
                {industries.length > 0 ? `已选 ${industries.length} 个` : "可不选"}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {INDUSTRIES.map((ind) => {
                const on = industries.includes(ind)
                return (
                  <Badge key={ind} asChild variant="outline">
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleIndustry(ind)}
                      className={`cursor-pointer transition-colors ${
                        on
                          ? "border-[#16335c] bg-[#16335c] text-[#f7f4ed] dark:border-[#f7f4ed] dark:bg-[#f7f4ed] dark:text-[#0a1c33]"
                          : "text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                      }`}
                    >
                      {ind}
                    </button>
                  </Badge>
                )
              })}
            </div>
          </div>

          {/* 04 每日推送时间 */}
          <div className="space-y-2.5">
            <Kicker>04 · 每日推送时间</Kicker>
            <RadioGroup
              value={pushTime}
              onValueChange={(v) => setPushTime(v)}
              className="gap-2"
            >
              {PUSH_OPTIONS.map((opt) => (
                <Label
                  key={opt.value}
                  className={`flex h-14 cursor-pointer items-center gap-3 rounded-lg border px-4 font-normal transition-colors ${
                    pushTime === opt.value
                      ? "border-[var(--crimson)]/60 bg-white/60 dark:bg-white/[0.05]"
                      : "border-border hover:border-foreground/40"
                  }`}
                >
                  <RadioGroupItem value={opt.value} />
                  <span>
                    <span className="block text-sm leading-tight">
                      {opt.value} · {opt.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">{opt.desc}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </div>

          {/* 05 推送渠道 */}
          <div className="space-y-2.5">
            <Kicker>05 · 推送渠道</Kicker>
            <div className="space-y-2">
              <div className="flex h-14 items-center justify-between rounded-lg border px-4">
                <span>
                  <span className="block text-sm leading-tight">邮件推送</span>
                  <span className="block text-xs text-muted-foreground">
                    每日一封，直进收件箱
                  </span>
                </span>
                <Switch
                  checked={channelEmail}
                  onCheckedChange={(v) => setChannelEmail(v)}
                  aria-label="邮件推送开关"
                />
              </div>
              <div className="flex h-14 items-center justify-between rounded-lg border px-4">
                <span>
                  <span className="block text-sm leading-tight">微信服务号</span>
                  <span className="block text-xs text-muted-foreground">
                    消息更快，演示环境仅作展示
                  </span>
                </span>
                <Switch
                  checked={channelWechat}
                  onCheckedChange={(v) => setChannelWechat(v)}
                  aria-label="微信服务号推送开关"
                />
              </div>
            </div>
          </div>
        </div>

        <Separator className="my-1" />

        <DialogFooter className="gap-2 sm:gap-0">
          {onLogout && (
            <Button
              type="button"
              variant="ghost"
              className="mr-auto h-11 text-muted-foreground hover:text-destructive"
              onClick={() => {
                onOpenChange(false)
                onLogout()
              }}
            >
              退出登录
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            先不改了
          </Button>
          <Button type="button" className="h-11 min-w-[128px]" onClick={save} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" /> 正在保存
              </>
            ) : (
              "保存，按这个口味开饭"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
