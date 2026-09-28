/**
 * 饭来 · 封面 v6 大图生成（Task 27-c：纯色极简「一碗新饭」封面）
 * 串行两张候选图 + 429 限流退避（sleep 20s，最多 3 次），跑完可不删。
 * 用法: bun scripts/gen-cover-v6.ts
 */
import ZAI from "z-ai-web-dev-sdk"
import fs from "fs"
import path from "path"

const OUT = "/home/z/my-project/public/images"
const LOG = "/home/z/my-project/scripts/gen-cover-v6.log"

type GenImageSize = "1344x768" | "1024x1024" | "768x1344" | "864x1152" | "1152x864" | "1440x720" | "720x1440"

const JOBS: { name: string; prompt: string; size: GenImageSize }[] = [
  {
    // 图 A（主推，静物摄影风）
    name: "cover-bowl-a",
    prompt:
      "极简静物摄影，纯净的奶油白色背景，画面中央一只巨大的极简白色陶瓷碗，碗中盛着饱满洁白的米饭，米饭上方悬浮一颗小小的朱红色圆球，大量留白，柔和晨光从侧面照入，浅浅的暖色投影，时尚杂志封面质感，高级感，无文字，无水印",
    size: "1344x768",
  },
  {
    // 图 B（备选，插画海报风）
    name: "cover-bowl-b",
    prompt:
      "极简日式海报插画，米白色纯色背景，一条优雅的黑色弧线勾出一只碗的轮廓，一颗朱红色圆点正落入碗中，溅起两三粒白色米粒，超大留白，极简构图，无文字",
    size: "1344x768",
  },
]

function log(msg: string) {
  fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`)
  console.log(msg)
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms)),
  ])
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const zai = await ZAI.create()
  log("SDK ready")

  for (const job of JOBS) {
    const outPath = path.join(OUT, `${job.name}.png`)
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10000) {
      log(`SKIP ${job.name}（已存在）`)
      continue
    }
    let ok = false
    // 串行 + 429 退避：失败 sleep 20s（限流）或 5s（其他），最多 3 次
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        log(`GEN ${job.name} attempt=${attempt}`)
        const res = await withTimeout(
          zai.images.generations.create({ prompt: job.prompt, size: job.size }),
          180000
        )
        const b64 = res?.data?.[0]?.base64
        if (!b64) throw new Error("empty base64")
        fs.writeFileSync(outPath, Buffer.from(b64, "base64"))
        log(`OK ${job.name} -> ${outPath}`)
        ok = true
      } catch (e) {
        const msg = (e as Error).message.slice(0, 200)
        const rateLimited = /429|rate|limit/i.test(msg)
        log(`ERR ${job.name} attempt=${attempt}: ${msg}`)
        if (attempt < 3) await sleep(rateLimited ? 20000 : 5000)
      }
    }
    if (!ok) log(`FAIL ${job.name}`)
    await sleep(5000) // 两张之间间隔 5s
  }
  log("ALL DONE")
}

main().catch((e) => {
  log(`FATAL ${e}`)
  process.exit(1)
})
