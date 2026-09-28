import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"

/**
 * 企业 LOGO 代理 + 磁盘缓存管道（Task 24-c 创建，Task 25-c 扩展多源）
 *
 * GET /api/logo?domain=taobao.com
 *   命中 → 200 图片二进制（Content-Type 按魔数嗅探）+ Cache-Control: public, max-age=2592000, immutable
 *   未命中且抓取失败 → 404（前端 onError 降级为行业渐变字标）
 *
 * 降级链路（未命中磁盘缓存时依次尝试；①~④ 每请求 5s 超时，⑤ 6s）：
 *   ① https://www.google.com/s2/favicons?domain={domain}&sz=128
 *      —— 响应须为图片且 >1500 字节（Google 对无 favicon 域名会返回 ~1KB 的默认地球小图，按字节阈值过滤）
 *   ② https://favicon.im/{domain}?larger=true
 *      —— 第三方图标聚合服务，对中国域名覆盖好于 Google；≥100 字节图片即收
 *   ②·5 https://unavatar.io/{domain}?size=128&fallback=false
 *      —— 多源聚合（clearbit 等），专补 128px 大图；无图标返回 404 状态，无占位图污染
 *   ③ https://icons.duckduckgo.com/ip3/{domain}.ico
 *      —— DuckDuckGo 图标源，与前两级互为补充；≥100 字节图片即收（未知域名它返回 404 状态，不占）
 *   ④ https://{domain}/favicon.ico（跟随重定向，5s 超时； apex 连不通时依次回退 https://www. / http://www. 变体重试）
 *   ⑤ https://{domain}/ 首页 HTML <link rel*=icon> 解析（Task 26-b 新增）：
 *      —— 抓首页（浏览器 UA、跟随重定向、最多读 512KB，apex 不通回退 www 变体），
 *        候选排序 apple-touch 优先（通常大图）→ sizes 最大 → href 含 apple-touch → 出现顺序，
 *        相对链接以重定向后的最终首页 URL 为 base 补全，逐个抓候选（最多 3 个，>1500 字节）
 *   ⑥ 都失败 → 写入内存负缓存（24h 内同域名不再出网），返回 404
 *
 * 每级只收 Content-Type 以 image/ 开头且魔数可识别（PNG/JPEG/GIF/ICO/WEBP/SVG）的响应，
 * 防 text/html 错误页伪装入缓存；
 * 另有固有尺寸门禁（Task 28-a）：位图短边解析 <48px（1×1 占位图、16px 迷你 favicon）一律拒收，
 * 继续走下一级降级源——小图放大到头像尺寸就是一团糊，观感等同裂图，宁缺毋滥。
 *
 * 缓存：public/logos/{domain}.img（域名已做 [a-z0-9.-] 白名单校验，防路径穿越）；
 * 并发安全：同一域名的并发未命中请求用内存 promise 去重，只出网一次。
 * 预热脚本用：附加 &retry=1 可跳过负缓存强制重抓（磁盘命中仍秒回，不受影响）。
 */

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const LOGO_DIR = path.join(process.cwd(), "public", "logos")
const BROWSER_TTL = "public, max-age=2592000, immutable" // 30 天
const FETCH_TIMEOUT_MS = 5000
const NEG_TTL_MS = 24 * 60 * 60 * 1000 // 负缓存 24h
const GOOGLE_MIN_BYTES = 1500 // 低于此视为 Google 默认地球占位图
const ICON_MIN_BYTES = 100 // favicon.im / DuckDuckGo：≥100 字节的图片响应即可收
const MAX_BYTES = 512 * 1024 // 抓取体积上限，防异常大响应
const UA = "Mozilla/5.0 (compatible; FanLaiBot/1.0; +https://fanlai.bot)"
const HTML_TIMEOUT_MS = 6000 // ⑤ 首页 HTML 抓取 / 候选图抓取超时（该级放宽到 6s）
const HOMEPAGE_ICON_MIN_BYTES = GOOGLE_MIN_BYTES + 1 // ⑤ 候选图标须 >1500 字节（同 Google 阈值，滤内联小装饰图）
// ⑤ 首页抓取用浏览器 UA：大量企业站对非浏览器 UA 直接 403/挑战页，拿不到 HTML
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

/** 域名白名单：只允许常规 hostname 字符，且必须含点、无连续点、不以点/连字符开头结尾 —— 杜绝路径穿越 */
function isSafeDomain(raw: string): boolean {
  return (
    raw.length >= 3 &&
    raw.length <= 100 &&
    raw.includes(".") &&
    !raw.includes("..") &&
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(raw)
  )
}

/** 按文件魔数嗅探真实 Content-Type */
function contentTypeOf(buf: Buffer): string {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png"
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg"
  if (buf.length >= 6) {
    const head6 = buf.subarray(0, 6).toString("latin1")
    if (head6 === "GIF87a" || head6 === "GIF89a") return "image/gif"
  }
  if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return "image/x-icon"
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP")
    return "image/webp"
  const head = buf.subarray(0, 200).toString("utf8").trimStart().toLowerCase()
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "image/svg+xml"
  return "application/octet-stream"
}

const isImage = (buf: Buffer) => contentTypeOf(buf) !== "application/octet-stream"

/** 固有尺寸门禁（Task 28-a）：低于此边长的位图不算真 LOGO —— 1×1 占位图 /
 *  16px 迷你 favicon 放大到 40px 头像后就是一团糊/空白，观感等同裂图，宁可降级字标。
 *  32px 是实用下限：列表头像 32/40px + 14% 内边距，32px 源尚可辨认。
 *  SVG 等解析不了的格式返回 null → 放行（矢量无损缩放，天然安全）。 */
const MIN_LOGO_PX = 32

/** 解析位图固有尺寸（PNG / JPEG / GIF / ICO / WEBP）；ICO 取目录内最大条目。
 *  解析不了返回 null（调用方放行，仍由魔数终审兜底）。 */
function imageSizeOf(buf: Buffer): { w: number; h: number } | null {
  // PNG：IHDR 里宽高各 4 字节 BE
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  }
  // JPEG：扫 SOF0~SOF15 段（跳过 DHT/SOS 等无关 marker）
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2
    while (o < buf.length - 9) {
      if (buf[o] !== 0xff) {
        o++
        continue
      }
      const marker = buf[o + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { w: buf.readUInt16BE(o + 7), h: buf.readUInt16BE(o + 5) }
      }
      const len = buf.readUInt16BE(o + 2)
      if (len < 2) return null
      o += 2 + len
    }
    return null
  }
  // GIF：逻辑屏幕尺寸 LE
  if (buf.length >= 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) }
  }
  // ICO：目录里每个条目 16 字节，宽高各 1 字节（0 = 256）；取最大条目而非首个
  if (buf.length >= 7 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) {
    const count = buf.readUInt16LE(4)
    let best = 0
    for (let i = 0; i < count; i++) {
      const off = 6 + i * 16
      if (off + 2 > buf.length) break
      best = Math.max(best, buf[off] || 256, buf[off + 1] || 256)
    }
    return best > 0 ? { w: best, h: best } : null
  }
  // WEBP：VP8X / VP8 / VP8L 三种 chunk 的尺寸编码各不相同
  if (
    buf.length >= 30 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    const chunk = buf.subarray(12, 16).toString("latin1")
    if (chunk === "VP8X") {
      return {
        w: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)),
        h: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)),
      }
    }
    if (chunk === "VP8 " && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
      return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
    }
    if (chunk === "VP8L" && buf[20] === 0x2f && (buf[21] & 0x40) !== 0) {
      const b = buf[21] | (buf[22] << 8) | (buf[23] << 16)
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }
    }
    return null
  }
  return null
}

type Fetcher = (domain: string) => Promise<Buffer | null>

type FetchImageRule = {
  minBytes: number // 最小字节数（含），低于此视为占位图/错误页
  strictCT: boolean // true 时要求响应头 Content-Type 以 image/ 开头（第三方图标服务偶发 text/html 错误页）
}

/** 通用抓图校验（各降级源共用）：默认 5s 超时（⑤ 级候选图传 6s）、跟随重定向；非 2xx / 体积越界 / 魔数不识别一律返回 null。
 *  魔数终审不可省：各源偶尔会带 image/* 头返回 HTML 错误页，且缓存里的字节最终要按魔数回 Content-Type。 */
async function fetchImage(url: string, rule: FetchImageRule, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<Buffer | null> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
    headers: { "User-Agent": UA },
  })
  if (!res.ok) return null
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < rule.minBytes || buf.length > MAX_BYTES) return null
  const ct = (res.headers.get("content-type") ?? "").toLowerCase()
  if (rule.strictCT && !ct.startsWith("image/")) return null
  if (!isImage(buf)) return null
  // 固有尺寸门禁：1×1 占位图 / <48px 迷你图标直接拒收 → 上层继续走下一级降级源
  const size = imageSizeOf(buf)
  if (size && Math.max(size.w, size.h) < MIN_LOGO_PX) return null
  return buf
}

/** ① Google favicon 服务：须是图片且 >1500 字节（过滤默认地球小图） */
const fetchGoogle: Fetcher = async (domain) =>
  fetchImage(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`, {
    minBytes: GOOGLE_MIN_BYTES + 1, // 保留「>1500」语义
    strictCT: false,
  })

/** favicon.im 对无图标域名会返回固定的灰色「f」圆形 SVG 占位图（所有未知域名字节相同），
 *  按 SHA-256 指纹拒收防错误图标污染缓存；该服务真实图标均为位图，SVG 一并拒收双保险。 */
const FAVICON_IM_PLACEHOLDER_SHA256 = "f594faa8f108ab9610dac7541200eadcaf558bd8944dc57e28f411a9a060ea9e"

/** ② favicon.im：≥100 字节图片即收，但须剔除固定占位图与 SVG */
const fetchFaviconIm: Fetcher = async (domain) => {
  const buf = await fetchImage(`https://favicon.im/${encodeURIComponent(domain)}?larger=true`, {
    minBytes: ICON_MIN_BYTES,
    strictCT: true,
  })
  if (!buf) return null
  if (contentTypeOf(buf) === "image/svg+xml") return null
  if (createHash("sha256").update(buf).digest("hex") === FAVICON_IM_PLACEHOLDER_SHA256) return null
  return buf
}

/** ②·5 Unavatar 聚合服务（Task 28-a 新增）：聚合 clearbit/favicon 等多源，?size=128 要大图、
 *  ?fallback=false 时无图标直接 404 状态（无占位图污染，无需指纹过滤）；
 *  排在 favicon.im 之后、DuckDuckGo 之前——前两级多给小图，这里专补大图。 */
const fetchUnavatar: Fetcher = async (domain) =>
  fetchImage(`https://unavatar.io/${encodeURIComponent(domain)}?size=128&fallback=false`, {
    minBytes: ICON_MIN_BYTES,
    strictCT: true,
  })

/** ③ DuckDuckGo icons：≥100 字节图片即收（未知域名返回 404 状态，天然无占位图） */
const fetchDuckDuckGo: Fetcher = async (domain) =>
  fetchImage(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`, {
    minBytes: ICON_MIN_BYTES,
    strictCT: true,
  })

/** ④ 官网根路径 favicon.ico：非空图片即收（尺寸门禁统一在 fetchImage 里裁决，小 ico 会被拒收下沉到 ⑤）。
 *  大量国内企业（尤其央企 .cn 站）apex 域从本服务器不可达 / 不解析，但 www 子域可达，
 *  依次回退 https://www.{d} → http://www.{d}（同一源的重试变体，非新增源；魔数校验挡掉 HTML 错误页）。 */
const fetchDirect: Fetcher = async (domain) => {
  for (const host of [domain, `www.${domain}`, `http://www.${domain}`]) {
    try {
      // ⚠️ try 必须包住单个变体：apex 域常见 DNS 不解析/连接被拒（抛异常），
      // 若异常外逸会被上层 catch 当作整个 ④ 级失败，www 变体就永远轮不到。
      const buf = await fetchImage(
        host.startsWith("http://") ? `${host}/favicon.ico` : `https://${host}/favicon.ico`,
        { minBytes: 1, strictCT: false },
      )
      if (buf) return buf
    } catch {
      // 该变体连不通 → 尝试下一变体
    }
  }
  return null
}

/** ⑤ 辅助：从响应体流式读取至多 cap 字节（读够即停并 cancel 剩余流），不为超大首页浪费内存/带宽 */
async function readCapped(res: Response, cap: number): Promise<Buffer> {
  const reader = res.body?.getReader()
  if (!reader) {
    return Buffer.from(await res.arrayBuffer()).subarray(0, cap)
  }
  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(Buffer.from(value))
        total += value.length
        if (total >= cap) break
      }
    }
  } finally {
    if (total >= cap) {
      try {
        await reader.cancel()
      } catch {
        // 流已结束/已出错时 cancel 抛错属正常
      }
    }
  }
  return Buffer.concat(chunks).subarray(0, cap)
}

/** ⑤ 辅助：正则提取单个标签里 name="value" / name='value' / name=value 属性（大小写不敏感） */
function attrOf(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim()
}

/** ⑤ 辅助：href 里 HTML 实体还原（企业站最常见的是把 & 转义成 &amp;） */
const decodeAmp = (s: string) => s.replace(/&amp;/gi, "&")

/** ⑤ 辅助：相对 URL 补全为绝对 URL（以重定向后的最终首页 URL 为 base），只放行 http/https/data */
function toAbsolute(href: string, base: string): string | null {
  try {
    const u = new URL(href, base)
    if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "data:") return null
    return u.toString()
  } catch {
    return null
  }
}

/** ⑤ 辅助：sizes="180x180" / "32x32 16x16" / "any" → 取最大边长（无则 0） */
function parseSizes(raw: string): number {
  let best = 0
  for (const m of raw.matchAll(/(\d+)\s*[x×]\s*(\d+)/gi)) {
    best = Math.max(best, Number(m[1]), Number(m[2]))
  }
  if (best > 0) return best
  const single = raw.match(/\d+/)
  return single ? Number(single[0]) : 0
}

type HomepageIcon = { url: string; apple: boolean; size: number; hrefApple: boolean; index: number }

/** ⑤ 辅助：从首页 HTML 提取去重排序后的图标候选 URL。
 *  每个标签的解析独立 try/catch：单个 link 标签写法再怪异，也只影响它自己。 */
function parseIconCandidates(html: string, base: string): string[] {
  const found: HomepageIcon[] = []
  const tags = html.match(/<link\b[^>]*>/gi) ?? []
  tags.forEach((tag, index) => {
    try {
      const rel = attrOf(tag, "rel").toLowerCase()
      if (rel.includes("mask-icon")) return // Safari 固定标签页单色剪影，不适合作品牌 LOGO
      const relTokens = rel.split(/\s+/)
      const apple = relTokens.some((t) => t.startsWith("apple-touch-icon")) // 覆盖 -precomposed 变体
      // "shortcut icon" 切词后含 icon；"apple-touch-icon*" 已由 apple 覆盖
      if (!apple && !relTokens.includes("icon")) return
      const href = decodeAmp(attrOf(tag, "href"))
      if (!href) return
      const url = toAbsolute(href, base)
      if (!url) return
      found.push({
        url,
        apple,
        size: parseSizes(attrOf(tag, "sizes")),
        hrefApple: /apple-touch/i.test(href),
        index,
      })
    } catch {
      // 该标签解析失败 → 跳过该标签
    }
  })
  // 排序：apple-touch 优先（通常是大图）→ sizes 最大 → href 含 apple-touch → 出现顺序
  found.sort(
    (a, b) =>
      (b.apple ? 1 : 0) - (a.apple ? 1 : 0) ||
      b.size - a.size ||
      (b.hrefApple ? 1 : 0) - (a.hrefApple ? 1 : 0) ||
      a.index - b.index,
  )
  const seen = new Set<string>()
  const urls: string[] = []
  for (const c of found) {
    const key = c.url.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    urls.push(c.url)
  }
  return urls
}

/** ⑤ 首页 HTML link 解析：④ 拿不到 /favicon.ico 时，很多站点首页 <head> 里仍声明了大尺寸 apple-touch-icon。
 *  任一环节失败都只返回 null → 上层照常走 404 负缓存，语义与既有级别完全一致。 */
const fetchHomepageLinks: Fetcher = async (domain) => {
  // 1) 抓首页：apex 不通（DNS 不解析/黑洞）时回退 www 变体——与 ④ 级同一现实（大量国内企业站 apex 不可达）
  let html = ""
  let base = ""
  for (const entry of [`https://${domain}/`, `https://www.${domain}/`]) {
    try {
      // ⚠️ try 必须包住单个入口（25-c 教训）：单入口异常绝不能外逸断送 www 变体
      const res = await fetch(entry, {
        signal: AbortSignal.timeout(HTML_TIMEOUT_MS),
        redirect: "follow",
        headers: { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" },
      })
      if (!res.ok) continue
      base = res.url || entry // 重定向后的最终 URL 才是相对链接的正确 base
      const buf = await readCapped(res, MAX_BYTES)
      html = buf.toString("utf8")
      if (html.trim()) break
    } catch {
      // 该入口抓取失败 → 尝试下一入口
    }
  }
  if (!html.trim()) return null

  // 2) 解析候选（内部逐标签 try/catch，异常只丢该标签）
  const candidates = parseIconCandidates(html, base)

  // 3) 逐个抓候选图（最多 3 个；>1500 字节 + 魔数终审；单个候选失败只跳过该候选）
  for (const url of candidates.slice(0, 3)) {
    try {
      const buf = await fetchImage(url, { minBytes: HOMEPAGE_ICON_MIN_BYTES, strictCT: false }, HTML_TIMEOUT_MS)
      if (buf) return buf
    } catch {
      // 该候选失败 → 尝试下一个候选
    }
  }
  return null
}

/** 同一域名并发去重：inflight 里挂 promise，大家等同一个抓取 */
const inflight = new Map<string, Promise<boolean>>()
/** 负缓存：抓取失败的域名 24h 内不再出网 */
const negCache = new Map<string, number>()

async function writeCache(domain: string, buf: Buffer): Promise<void> {
  await fs.mkdir(LOGO_DIR, { recursive: true })
  const target = path.join(LOGO_DIR, `${domain}.img`)
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp` // 临时文件 + 原子改名，避免半截文件永久入缓存
  await fs.writeFile(tmp, buf)
  await fs.rename(tmp, target)
}

async function resolveAndCache(domain: string, force = false): Promise<boolean> {
  if (!force) {
    // 负缓存：预热脚本传 retry=1 时跳过，保证失败域名在本轮真实重抓
    const neg = negCache.get(domain)
    if (neg !== undefined && Date.now() - neg < NEG_TTL_MS) return false
  }

  // 并发去重读取侧（Task 26-b 补上 24-c 遗漏）：已有在途任务直接等它，
  // 避免 ⑤ 级任务变长后，预热重试与用户请求对同域重复出网
  const running = inflight.get(domain)
  if (running) return running

  const job = (async () => {
    for (const fetcher of [
      fetchGoogle,
      fetchFaviconIm,
      fetchUnavatar,
      fetchDuckDuckGo,
      fetchDirect,
      fetchHomepageLinks,
    ] as const) {
      try {
        const buf = await fetcher(domain)
        if (buf) {
          await writeCache(domain, buf)
          return true
        }
      } catch {
        // 超时 / DNS 失败 / 网络错误 → 尝试下一级
      }
    }
    negCache.set(domain, Date.now())
    // 负缓存防膨胀：超过 500 条时顺手清一遍过期项
    if (negCache.size > 500) {
      const now = Date.now()
      for (const [k, t] of negCache) if (now - t >= NEG_TTL_MS) negCache.delete(k)
    }
    return false
  })()

  inflight.set(domain, job)
  try {
    return await job
  } finally {
    inflight.delete(domain)
  }
}

function imageResponse(buf: Buffer): Response {
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": contentTypeOf(buf),
      "Content-Length": String(buf.length),
      "Cache-Control": BROWSER_TTL,
    },
  })
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const domain = (url.searchParams.get("domain") ?? "").trim().toLowerCase()
  if (!isSafeDomain(domain)) {
    return new Response("invalid domain", { status: 400, headers: { "Cache-Control": "no-store" } })
  }

  // 1) 磁盘缓存命中直接回源（0 字节残文件视为未命中，自动重抓自愈）
  const file = path.join(LOGO_DIR, `${domain}.img`)
  try {
    const cached = await fs.readFile(file)
    if (cached.length > 0) return imageResponse(cached)
  } catch {
    // ENOENT：目录或文件尚未生成
  }

  // 2) 未命中 → 抓取落盘（promise 去重 + 负缓存兜底；retry=1 跳过负缓存，供预热脚本强制重抓）
  const ok = await resolveAndCache(domain, url.searchParams.get("retry") === "1")
  if (!ok) {
    return new Response("logo unavailable", { status: 404, headers: { "Cache-Control": "no-store" } })
  }

  // 3) 落盘后读回（理论上必命中；极端竞争下读不到则降 404）
  try {
    const buf = await fs.readFile(file)
    return imageResponse(buf)
  } catch {
    return new Response("logo unavailable", { status: 404, headers: { "Cache-Control": "no-store" } })
  }
}
