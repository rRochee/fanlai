"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"

/**
 * 行业渐变色对：从品牌五声部（绯红/天蓝/蓝绿/淡蓝/墨蓝）衍生 + 琥珀金/松绿/钢蓝，
 * 18 个行业轮换 10 组，同一行业恒定同一色。
 * 用固定饱和色（不随主题变量翻转），亮/暗主题下白色粗体首字都保持清晰。
 */
const GRADIENTS = [
  "from-[#d8362a] to-[#9e241a]", // 绯红
  "from-[#dd5f3c] to-[#a63a1e]", // 珊瑚暖橙
  "from-[#b07f14] to-[#7d5a0c]", // 琥珀金
  "from-[#1e88c7] to-[#145f95]", // 天蓝
  "from-[#16699b] to-[#0c4768]", // 深海蓝
  "from-[#4f7fb5] to-[#31568a]", // 淡蓝
  "from-[#123c6d] to-[#0a2547]", // 墨蓝
  "from-[#0d8a80] to-[#075e57]", // 蓝绿
  "from-[#2e8467] to-[#1a5f49]", // 青松绿
  "from-[#4a6076] to-[#2b3d4f]", // 钢灰蓝
] as const

/** 行业 → 色对编号（优先赛道各自专属，其余按气质就近分配） */
const INDUSTRY_TONE: Record<string, number> = {
  科技零售: 3,
  智能制造: 9,
  消费电子: 0,
  智能硬件: 7,
  供应链与物流: 5,
  进出口贸易: 4,
  医疗健康: 8,
  实业与新能源: 2,
  互联网与软件: 1,
  汽车与出行: 6,
  消费品与快消: 1,
  金融与银行: 6,
  教育与培训: 2,
  文化与传媒: 0,
  法律与专业服务: 9,
  地产与建筑: 1,
  国企与公用事业: 9,
  酒旅与航空: 4,
}

/** 行业 → 渐变类名；未知行业按名称稳定散列取色（同名恒定同色），无行业信息用墨蓝兜底 */
export function industryGradient(industry?: string | null): string {
  if (!industry) return GRADIENTS[6]
  const known = INDUSTRY_TONE[industry]
  if (known !== undefined) return GRADIENTS[known]
  let h = 0
  for (let i = 0; i < industry.length; i++) h = (h * 31 + industry.charCodeAt(i)) >>> 0
  return GRADIENTS[h % GRADIENTS.length]
}

/**
 * 企业头像徽章：
 * - 传 logoDomain（由 recruitUrl 提取的注册主域，见 @/lib/logo）时加载真实 LOGO：
 *   加载完成前显示行业渐变字标（兼作加载骨架），图片 onLoad 后淡入盖在字标上；
 *   onError（/api/logo 404）时只保留字标，行为与不传 logoDomain 完全一致。
 * - 真实 LOGO 就位后（Task 26-o）：底色换成白底 + 细描边，图片 object-contain
 *   且四周留 14% 内边距——修掉「渐变底色透出、LOGO 被衬得看不清」的遮盖问题。
 * - 不传 logoDomain 时即纯行业渐变字标徽章（原有行为，保持兼容）。
 * 列表/看板默认 size-10；详情页等大尺寸用 className 覆盖（如 size-16 rounded-xl text-[24px]）。
 */
export function CompanyAvatar({
  name,
  industry,
  className,
  logoDomain,
}: {
  name: string
  industry?: string | null
  className?: string
  /** 注册主域（如 alibaba.com）；/api/logo 代理 + 磁盘缓存服务端渲染真 LOGO */
  logoDomain?: string | null
}) {
  const char = name.replace(/[（(].*$/, "").slice(0, 1) || "企"

  // img 加载态：loading（字标即骨架）→ ready（淡入真 LOGO）/ failed（永久回退字标）
  const [imgState, setImgState] = useState<"loading" | "ready" | "failed">("loading")
  // 换企业（组件实例复用，如详情页推荐列表）时重置加载态
  const [renderedDomain, setRenderedDomain] = useState(logoDomain)
  if (logoDomain !== renderedDomain) {
    setRenderedDomain(logoDomain)
    setImgState("loading")
  }

  const showImg = !!logoDomain && imgState !== "failed"
  // LOGO 就位：白底 + 细描边（透明底/深色底 favicon 都清晰）；未就位：行业渐变字标
  const logoReady = showImg && imgState === "ready"

  return (
    <span
      aria-hidden
      className={cn(
        "font-display relative flex shrink-0 select-none items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br text-[17px] font-bold text-white size-10",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_1px_3px_rgba(12,35,64,0.2)]",
        "[text-shadow:0_1px_1px_rgba(9,22,42,0.18)]",
        logoReady ? "bg-white ring-1 ring-black/10 dark:ring-white/15" : industryGradient(industry),
        className
      )}
    >
      {char}
      {showImg && (
        <img
          key={logoDomain}
          ref={(el) => {
            // 兼容浏览器内存缓存命中：图片可能在 onLoad/onError 挂上前就完成加载，按 complete 状态补判定
            if (!el || !el.complete) return
            setImgState(el.naturalWidth > 0 ? "ready" : "failed")
          }}
          src={`/api/logo?domain=${encodeURIComponent(logoDomain)}&v=2`}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          draggable={false}
          onLoad={() => setImgState("ready")}
          onError={() => setImgState("failed")}
          className={cn(
            // contain + 14% 内边距：favicon 完整呈现，不裁切、不贴边、不被底色衬花
            "absolute inset-0 size-full rounded-[inherit] object-contain p-[14%] transition-opacity duration-300",
            imgState === "ready" ? "opacity-100" : "opacity-0"
          )}
        />
      )}
    </span>
  )
}
