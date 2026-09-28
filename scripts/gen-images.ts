/**
 * 饭来 · 配图批量生成（SDK 直调，指数退避，幂等跳过）
 * 用法: setsid nohup bun run scripts/gen-images.ts > /dev/null 2>&1 < /dev/null &
 */
import ZAI from "z-ai-web-dev-sdk"
import fs from "fs"
import path from "path"

const OUT = "/home/z/my-project/public/images"
const LOG = "/home/z/my-project/scripts/gen-images.log"

const STYLE =
  "minimalist flat illustration, thin elegant line art, muted pine green and warm ivory color palette, generous negative space, calm editorial magazine style, soft paper texture, no text, no letters, no words"

/** SDK 支持的生成尺寸（与 z-ai-web-dev-sdk images.generations.create 的 size 联合类型对齐） */
type GenImageSize = "1344x768" | "1024x1024" | "768x1344" | "864x1152" | "1152x864" | "1440x720" | "720x1440"

const JOBS: { name: string; subject: string; size: GenImageSize }[] = [
  { name: "hero", subject: "a steaming rice bowl beside a folded morning newspaper and a small sprig of leaves on a warm ivory desk, top view", size: "1344x768" },
  { name: "cover-retail", subject: "a minimal storefront with striped awning, a shopping bag and a small shopping cart", size: "1344x768" },
  { name: "cover-manufacturing", subject: "a precise robotic arm above an assembly line with gear outlines", size: "1344x768" },
  { name: "cover-electronics", subject: "a smartphone, wireless earbuds and a smartwatch arranged on ivory background", size: "1344x768" },
  { name: "cover-hardware", subject: "a flying camera drone and a gimbal with small sensor chips floating around", size: "1344x768" },
  { name: "cover-supplychain", subject: "stacked shipping containers, a small forklift and a dashed route line across a warehouse floor", size: "1344x768" },
  { name: "cover-trade", subject: "a cargo ship at a quiet harbor with two cranes and stacked containers, distant horizon", size: "1344x768" },
  { name: "cover-health", subject: "a stethoscope forming a gentle curve beside a green leaf and a subtle medical cross", size: "1344x768" },
  { name: "cover-industrial", subject: "solar panels, a wind turbine and a battery cell with a small circuit motif", size: "1344x768" },
  { name: "cover-internet", subject: "a minimal browser window with code brackets and floating chat bubbles", size: "1344x768" },
  { name: "cover-auto", subject: "a sleek electric car silhouette with a charging bolt and road line", size: "1344x768" },
  { name: "cover-consumer", subject: "minimal product boxes, a perfume bottle and a sneaker with a shopping tag", size: "1344x768" },
  { name: "cover-finance", subject: "a minimal bank building facade with columns and a small rising line chart", size: "1344x768" },
]

function log(msg: string) {
  fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`)
}

/** 带超时的单次生成（120s） */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms)),
  ])
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const zai = await ZAI.create()
  log("SDK ready")

  for (const job of JOBS) {
    const outPath = path.join(OUT, `${job.name}.png`)
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10000) {
      log(`SKIP ${job.name}`)
      continue
    }
    let ok = false
    for (let attempt = 1; attempt <= 8 && !ok; attempt++) {
      try {
        log(`GEN ${job.name} attempt=${attempt}`)
        const res = await withTimeout(
          zai.images.generations.create({
            prompt: `${job.subject}, ${STYLE}`,
            size: job.size,
          }),
          120000
        )
        const b64 = res?.data?.[0]?.base64
        if (!b64) throw new Error("empty base64")
        fs.writeFileSync(outPath, Buffer.from(b64, "base64"))
        log(`OK ${job.name}`)
        ok = true
      } catch (e) {
        const msg = (e as Error).message.slice(0, 160)
        log(`ERR ${job.name} attempt=${attempt}: ${msg}`)
        await new Promise((r) => setTimeout(r, Math.min(180000, 25000 * attempt)))
      }
    }
    if (!ok) log(`FAIL ${job.name}`)
    await new Promise((r) => setTimeout(r, 15000)) // 间隔限速
  }
  log("ALL DONE")
}

main().catch((e) => {
  log(`FATAL ${e}`)
  process.exit(1)
})
