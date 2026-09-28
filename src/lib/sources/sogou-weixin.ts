// 饭来 · 搜狗微信直搜抓取器（weixin.sogou.com/weixin?type=2 文章搜索）
// —— 为什么存在：主同步走通用联网检索「间接」触达公众号推文；本管道按用户授权直搜搜狗微信
//    收录的公众号文章池，标题 / 摘要 / 公众号名 / 发布时间一次拿全，作为 SourceArticle 原始档案。
// 设计约束：
// · 纯 HTTP 抓取（不依赖 z-ai-web-dev-sdk / LLM），命中企业靠 matcher.ts 确定性匹配；
// · 多关键词顺序抓取，关键词间随机间隔 2~4s，带浏览器 UA + Referer + Accept-Language；
// · 反爬检测（antispider / 验证码 / 结果页标题不符）抛 SogouBlockedError——该关键词跳过、
//   记日志、绝不重试轰炸（搜狗限流以「时段」为窗口，重试只会加重）；
// · 每个关键词只取第一页前 10 条，抓多无用、徒增限流风险。

export interface RawArticle {
  title: string
  account: string // 公众号名称
  url: string // 搜狗跳转链绝对URL（浏览器点击可跳真实微信文章）
  publishedAt: Date | null // timeConvert 时间戳解析，缺失为 null
  summary: string
  query: string // 命中的搜索词
}

/** 被搜狗反爬拦截（验证码 / antispider / 结果页标题不符），区别于普通网络失败 */
export class SogouBlockedError extends Error {}

/** 直搜关键词组（每天随主同步各抓一轮第一页） */
export const DEFAULT_SOGOU_QUERIES: string[] = ["27届秋招", "2027秋招", "秋招 企业", "校招 开启"]

const SOGOU_ORIGIN = "https://weixin.sogou.com"
const SOGOU_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
const FETCH_TIMEOUT_MS = 15_000

/** 结果页标题形如「27届秋招的相关微信公众号文章 – 搜狗微信搜索」；不符即视为被拦截 */
const RESULT_TITLE_RE = /微信公众号文章\s*[–—-]\s*搜狗微信搜索/
const TITLE_TAG_RE = /<title>([\s\S]*?)<\/title>/i

export interface SogouQueryReport {
  query: string
  ok: boolean
  hits: number
  blocked: boolean
  error?: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 剥 HTML 注释（<!--red_beg-->）与标签，解码常见实体，压平空白 */
function stripTags(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&hellip;/gi, "…")
    .replace(/&mdash;/gi, "—")
    .replace(/&middot;/gi, "·")
    .replace(/&rarr;/gi, "→")
    .replace(/&larr;/gi, "←")
    .replace(/\s+/g, " ")
    .trim()
}

/** href 来自 HTML 属性，实体需还原（&amp;type=2 不还原会破坏跳转 token 参数名） */
function absoluteLink(href: string): string {
  const h = href.replace(/&amp;/gi, "&").trim()
  if (h.startsWith("//")) return `https:${h}`
  if (h.startsWith("/")) return `${SOGOU_ORIGIN}${h}`
  return h
}

/**
 * 单条结果解析（选择器已对真实结果页逐项确认，存档 /tmp/sogou-real.html）：
 * · 每条结果包在 <div class="txt-box"> 里（第一页恰好 10 个）
 * · 标题：<h3><a ... uigs="article_title_N">…</a></h3>，关键词带 <em> 高亮
 * · 账号：<span class="all-time-y2">账号名</span>（个别版式为 <a class="all-time-y2">，两者兼容）
 * · 摘要：<p class="txt-info">…</p>
 * · 时间：<script>document.write(timeConvert('1788254134'))</script>（unix 秒）
 */
function parseResultChunk(chunk: string, query: string): RawArticle | null {
  const anchor = chunk.match(/<a\s[^>]*uigs="article_title_\d+"[^>]*>([\s\S]*?)<\/a>/i)
  if (!anchor) return null
  const title = stripTags(anchor[1]).slice(0, 120)
  const href = anchor[0].match(/href="([^"]*)"/i)?.[1] ?? ""
  if (!title || !href) return null
  const account = stripTags(
    chunk.match(/<[^>]*class="all-time-y2"[^>]*>([\s\S]*?)<\/(?:span|a)>/i)?.[1] ?? ""
  )
  const summary = stripTags(chunk.match(/<p class="txt-info"[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "")
  const ts = chunk.match(/timeConvert\('(\d+)'\)/)?.[1]
  return {
    title,
    account: (account || "未知公众号").slice(0, 60),
    summary: summary.slice(0, 300),
    publishedAt: ts ? new Date(parseInt(ts, 10) * 1000) : null,
    url: absoluteLink(href).slice(0, 1024),
    query,
  }
}

/** 解析一页结果 HTML；返回条数可能为 0（合法的「无结果」页） */
export function parseSogouResultHtml(html: string, query: string): RawArticle[] {
  return html
    .split(/<div class="txt-box">/i)
    .slice(1)
    .map((chunk) => parseResultChunk(chunk, query))
    .filter((a): a is RawArticle => a !== null)
}

/** 反爬检测：极短返回体 / antispider / seccode / 验证码 / 结果页标题不符 → SogouBlockedError */
function assertNotBlocked(html: string): void {
  if (html.length < 2000 || /antispider|seccode|验证码/i.test(html)) {
    throw new SogouBlockedError(`返回 ${html.length} 字节，含反爬信号`)
  }
  const title = stripTags(html.match(TITLE_TAG_RE)?.[1] ?? "")
  if (!RESULT_TITLE_RE.test(title)) {
    throw new SogouBlockedError(`结果页标题不符：「${title.slice(0, 40)}」`)
  }
}

/**
 * 多关键词顺序抓取搜狗微信文章（每个关键词取第一页前 10 条）。
 * 单个关键词被限流 / 网络失败：记日志（onQueryDone 回调可选上报）后跳过，不重试、不中断其余关键词。
 */
export async function fetchSogouWeixin(
  queries: string[],
  opts?: { onQueryDone?: (report: SogouQueryReport) => void }
): Promise<RawArticle[]> {
  const out: RawArticle[] = []
  const seen = new Set<string>() // 组内去重：同一标题+账号在多个关键词下重复出现只收一次

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i].trim()
    if (!query) continue
    if (i > 0) await sleep(2000 + Math.floor(Math.random() * 2000)) // 关键词间随机间隔 2~4s

    const url = `${SOGOU_ORIGIN}/weixin?type=2&query=${encodeURIComponent(query)}`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": SOGOU_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9",
          Referer: `${SOGOU_ORIGIN}/`,
        },
        signal: ctrl.signal,
        cache: "no-store",
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const html = await res.text()
      assertNotBlocked(html)
      const articles = parseSogouResultHtml(html, query).slice(0, 10)
      for (const a of articles) {
        const key = `${a.account}|${a.title}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push(a)
      }
      opts?.onQueryDone?.({ query, ok: true, hits: articles.length, blocked: false })
    } catch (e) {
      const blocked = e instanceof SogouBlockedError
      const msg = (e as Error).name === "AbortError" ? "请求超时（15s）" : (e as Error).message.slice(0, 80)
      // 反爬 / 失败：记日志后跳过该关键词，绝不重试轰炸（下轮同步自然再试）
      console.warn(`[sogou-weixin] 「${query}」${blocked ? "被搜狗反爬拦截" : "抓取失败"}：${msg}`)
      opts?.onQueryDone?.({ query, ok: false, hits: 0, blocked, error: msg })
    } finally {
      clearTimeout(timer)
    }
  }

  return out
}
