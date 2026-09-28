/**
 * 饭来 · 配图 v2 重制（risograph 丝网版画风）
 * 用户反馈不喜欢旧版细线稿风格 → 整套换成双墨色版画质感：
 *   浅色系：松墨绿 + 柿橘双墨印刷在暖米纸上，粗颗粒网点、套印微偏
 *   深色 hero：墨夜纸底 + 玉青/琥珀墨
 * 串行执行 + 429 退避重试（每次生成覆盖旧图，同名文件无需改前端引用）
 * 用法: setsid nohup bun run scripts/gen-images-v2.ts > /dev/null 2>&1 < /dev/null &
 */
import ZAI from "z-ai-web-dev-sdk"
import fs from "fs"
import path from "path"

const OUT = "/home/z/my-project/public/images"
const LOG = "/home/z/my-project/scripts/gen-images-v2.log"

const STYLE_LIGHT =
  "risograph two-ink screen print poster, deep pine green ink and warm persimmon orange ink on warm cream paper, bold flat organic shapes, coarse riso print grain texture, subtle ink misregistration, mid-century japanese editorial print aesthetic, large calm negative space, no text, no letters, no words, no watermark"

const STYLE_DARK =
  "risograph two-ink screen print poster, soft jade green ink and warm amber ink printed on deep charcoal night paper, bold flat organic shapes, coarse riso print grain texture, subtle ink misregistration, mid-century japanese editorial print aesthetic, a small warm moonlight glow, large calm negative space, no text, no letters, no words, no watermark"

const JOBS: { name: string; subject: string; size: string; style: string }[] = [
  {
    name: "hero",
    size: "1344x768",
    style: STYLE_LIGHT,
    subject:
      "a round rice bowl with three rising steam curls beside a folded morning newspaper and a small leafy branch on a table, wide horizontal morning still life composition",
  },
  {
    name: "hero-dark",
    size: "1344x768",
    style: STYLE_DARK,
    subject:
      "a round rice bowl with three rising steam curls beside a folded newspaper and a small leafy branch on a dark wooden table at night, wide horizontal still life composition",
  },
  {
    name: "cover-retail",
    size: "1344x768",
    style: STYLE_LIGHT,
    subject: "a small shopfront with striped awning, one hanging round sign and a single shopping bag, flat geometric composition",
  },
  {
    name: "cover-manufacturing",
    size: "1344x768",
    style: STYLE_LIGHT,
    subject: "a bold robotic arm silhouette over a conveyor line with two large gears, flat industrial composition",
  },
  {
    name: "cover-electronics",
    size: "1344x768",
    style: STYLE_LIGHT,
    subject: "a smartphone, a wireless earbuds case and a smartwatch arranged in a neat row, flat tech still life",
  },
  {
    name: "cover-hardware",
    size: "1344x768",
    style: STYLE_LIGHT,
    subject: "a camera drone with four round propellers hovering above a camera gimbal, flat geometric composition",
  },
  {
    name: "cover-supplychain",
    size: "1344x768",
    style: STYLE_LIGHT,
    subject: "three stacked shipping containers with a small forklift below and a dashed route arc, flat warehouse composition",
  },
  {
    name: "cover-trade",
    size: "1344x768",
    style: STYLE_LIGHT,
    subject: "a flat cargo ship on calm sea with two cranes and stacked containers, one big sun disk behind, wide horizon composition",
  },
  {
    name: "cover-health",
    size: "1344x768",
    style: STYLE_LIGHT,
    subject: "a stethoscope curled into a soft spiral beside one leaf shape and a rounded medical cross, flat still life",
  },
  {
    name: "cover-industrial",
    size: "1344x768",
    style: STYLE_LIGHT,
    subject: "a solar panel, one wind turbine and a rounded battery cell standing on a single hill line, flat energy landscape",
  },
  {
    name: "cover-internet",
    size: "1344x768",
    style: STYLE_LIGHT,
    subject: "a browser window with abstract rounded code blocks and two floating speech bubbles, flat UI composition",
  },
  {
    name: "cover-auto",
    size: "1344x768",
    style: STYLE_LIGHT,
    subject: "a sleek electric car silhouette with a charging cable arc and one road line, flat automotive composition",
  },
  {
    name: "cover-consumer",
    size: "1344x768",
    style: STYLE_LIGHT,
    subject: "a sneaker, a perfume bottle and a gift box standing in a row with one price tag, flat product still life",
  },
  {
    name: "cover-finance",
    size: "1344x768",
    style: STYLE_LIGHT,
    subject: "a classical bank building with three columns beside a rising line chart step and one coin, flat fintech composition",
  },
]

function log(msg: string) {
  fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`)
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms)),
  ])
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function genOne(zai: Awaited<ReturnType<typeof ZAI.create>>, job: (typeof JOBS)[number]) {
  const outPath = path.join(OUT, `${job.name}.png`)
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      log(`${job.name}: attempt ${attempt}`)
      const res = (await withTimeout(
        zai.images.generations.create({
          prompt: `${job.subject}, ${job.style}`,
          size: job.size as "1024x1024" | "768x1344" | "864x1152" | "1344x768" | "1152x864" | "1440x720" | "720x1440",
        }),
        180_000
      )) as { data?: { base64?: string }[] }
      const b64 = res?.data?.[0]?.base64
      if (!b64) throw new Error("empty result")
      const prev = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0
      fs.writeFileSync(outPath, Buffer.from(b64, "base64"))
      log(`OK ${job.name} (${(prev / 1024).toFixed(0)}KB -> ${(Buffer.from(b64, "base64").length / 1024).toFixed(0)}KB)`)
      return true
    } catch (e) {
      const msg = (e as Error).message.slice(0, 120)
      log(`RETRY ${job.name} attempt=${attempt} err=${msg}`)
      await sleep(12_000 * attempt + Math.floor(Math.random() * 4000))
    }
  }
  log(`FAIL ${job.name}`)
  return false
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const zai = await ZAI.create()
  log(`=== v2 restyle start: ${JOBS.length} images, risograph style ===`)
  let ok = 0
  let fail = 0
  for (const job of JOBS) {
    const success = await genOne(zai, job)
    if (success) ok++
    else fail++
    // 限流保护：每张之间强制间隔
    await sleep(4000)
  }
  log(`=== v2 restyle done: ok=${ok} fail=${fail} ===`)
}

main().catch((e) => {
  log(`FATAL ${(e as Error).message}`)
  process.exit(1)
})
