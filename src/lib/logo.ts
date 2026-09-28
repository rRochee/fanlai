/**
 * 企业 LOGO 管道 · 共享工具
 * domainFromUrl：从企业 recruitUrl 提取「注册主域」，供 /api/logo 代理与前端 <img> 使用。
 */

/** 常见双段后缀：命中时取倒数三段（lenovo.com.cn → lenovo.com.cn 的主体是 lenovo） */
const MULTI_SUFFIXES = new Set([
  // 中国
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "ac.cn",
  // 日本 / 韩国 / 印度 / 东南亚
  "co.jp", "ne.jp", "or.jp", "ac.jp", "co.kr", "or.kr", "co.in", "net.in", "org.in",
  "com.sg", "com.my", "com.ph", "com.vn", "com.th", "co.th", "co.id", "com.hk",
  // 其他常见地区
  "co.uk", "org.uk", "ac.uk", "com.tw", "org.tw", "com.au", "net.au", "co.nz",
  "com.br", "com.mx", "com.ar", "com.tr", "com.ua", "co.za",
])

/** 招聘平台 / ATS / 公众号托管域（Task 28-b）：recruitUrl 挂在这些域名下时，
 *  提取到的是平台域名 → 展示平台 logo（应届生/飞书/QQ…）冒充企业 logo，属张冠李戴。
 *  命中一律返回 null，前端走行业渐变字标兜底——好过错误的身份。
 *  已核对名录：这些平台自身没有作为企业收录，无误伤。 */
const BOARD_HOST_PATTERNS: RegExp[] = [
  /^[\w-]+\.jobs\.feishu\.cn$/, // 飞书招聘 ATS（如 zj-innolight.jobs.feishu.cn）
  /^(mp|work)\.weixin\.qq\.com$/, // 微信公众号 / 企业微信文章
  /(^|\.)yingjiesheng\.com$/, // 应届生求职网
  /(^|\.)mokahr\.com$/, // Moka ATS
  /(^|\.)zhiye\.com$/, // 北森 ATS
  /(^|\.)zhaopin\.com$/, // 智联招聘
  /(^|\.)zhipin\.com$/, // BOSS 直聘
  /(^|\.)51job\.com$/, // 前程无忧
  /(^|\.)liepin\.com$/, // 猎聘
  /(^|\.)nowcoder\.com$/, // 牛客
  /(^|\.)shixiseng\.com$/, // 实习僧
]

/**
 * 提取注册主域（小写，不含 www / 端口 / 路径）：
 * - https://campus.oppo.com       → oppo.com
 * - https://talent.lenovo.com.cn  → lenovo.com.cn（com.cn 双后缀）
 * - https://www.miniso.com        → miniso.com
 * - https://careers.walmart.com.cn→ walmart.com.cn
 * - https://mp.weixin.qq.com/...  → null（招聘平台托管，防冒用平台 logo）
 * 解析失败 / 非常规域名返回 null（调用方不传 logoDomain，走渐变字标 fallback）。
 */
export function domainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  let hostname: string
  try {
    hostname = new URL(url.includes("://") ? url : `https://${url}`).hostname
  } catch {
    return null
  }
  hostname = hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "")
  // 平台托管域在归约前按完整 hostname 判定（zhaopin.chinatowercom.cn 不受 zhaopin 规则影响）
  if (BOARD_HOST_PATTERNS.some((re) => re.test(hostname))) return null
  const parts = hostname.split(".").filter(Boolean)
  if (parts.length < 2) return null
  const last2 = parts.slice(-2).join(".")
  const registered = parts.length >= 3 && MULTI_SUFFIXES.has(last2) ? parts.slice(-3).join(".") : last2
  // 防御性兜底：只放行常规域名字符（正常 hostname 不会含其他字符）
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(registered)) return null
  if (registered.length > 100) return null
  return registered
}
