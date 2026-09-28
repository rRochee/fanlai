/**
 * 饭来 · 深色版 hero 插画（幂等跳过已有）
 * 用法: setsid nohup bun run scripts/gen-hero-dark.ts > /dev/null 2>&1 < /dev/null &
 */
import ZAI from "z-ai-web-dev-sdk"
import fs from "fs"
import path from "path"

const OUT = "/home/z/my-project/public/images"
const LOG = "/home/z/my-project/scripts/gen-images.log"

const STYLE =
  "minimalist flat illustration, thin elegant line art, muted moss green and warm amber accents on a deep charcoal night background, generous negative space, calm editorial magazine style, no text, no letters, no words"

const SUBJECT =
  "a steaming rice bowl beside a folded newspaper and a small sprig of leaves on a dark wooden desk at night, a soft warm lamp glow from one side, top view"

function log(msg: string) {
  fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`)
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms)),
  ])
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const zai = await ZAI.create()
  log("hero-dark: SDK ready")

  const outPath = path.join(OUT, "hero-dark.png")
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10000) {
    log("SKIP hero-dark")
    return
  }
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      log(`GEN hero-dark attempt=${attempt}`)
      const res = await withTimeout(
        zai.images.generations.create({
          prompt: `${SUBJECT}, ${STYLE}`,
          size: "1344x768",
        }),
        120_000
      )
      const b64 = res?.data?.[0]?.base64
      // SDK 类型未声明 url 字段，但运行时可能返回可下载地址
      const url = (res?.data?.[0] as { base64?: string; url?: string } | undefined)?.url
      if (b64) {
        fs.writeFileSync(outPath, Buffer.from(b64, "base64"))
        log(`OK hero-dark (b64)`)
        return
      }
      if (url) {
        const r = await fetch(url)
        if (!r.ok) throw new Error(`download ${r.status}`)
        fs.writeFileSync(outPath, Buffer.from(await r.arrayBuffer()))
        log(`OK hero-dark (url)`)
        return
      }
      throw new Error("empty response")
    } catch (e) {
      log(`FAIL hero-dark attempt=${attempt}: ${(e as Error).message.slice(0, 120)}`)
      await new Promise((r) => setTimeout(r, Math.min(60_000, 4000 * 2 ** (attempt - 1))))
    }
  }
  log("GIVEUP hero-dark")
}

main()
