/**
 * 太阳直射点实时计算（Task 29）——海浪光色的物理时钟。
 *
 * 用户要求：海浪色调要随一天中太阳直射点的位置从冷色转变为暖色，
 * 且必须「实时校对当前实际北京时间」。本模块用 Spencer 太阳位置公式
 * （NOAA 简化版：赤纬 + 均时差）计算太阳高度角/时角，把「真实世界时间」
 * 直接映射成海面的光色状态——清晨冷蓝 → 日出金光 → 正午天光最盛 →
 * 午后斜阳 → 黄昏暖金 → 深夜冷月，全部连续过渡、无档位感。
 *
 * 时间口径：所有输入都是「UTC 纪元毫秒」，北京时间 = UTC+8 纯偏移换算
 * （不依赖 Intl / 设备时区）。客户端用 /api/time 的服务器纪元校准本机
 * 时钟偏差（offset = server - client），再喂给本模块，保证沙箱/设备
 * 时钟不准时海面光色依然正确。
 *
 * 观测点：北京（39.9°N, 116.4°E）——用户以北京时间锚定光色，用首都
 * 太阳位置作为全国通用近似足够（高度角纬度误差 ≤ ~5°，不影响冷暖判断）。
 */

export type SolarState = {
  elevDeg: number // 太阳高度角（度，<0 在地平线下）
  x01: number // 天幕横坐标 0~1（东 → 西，含夜间月亮接管混合）
  y01: number // 天幕纵坐标 0~1（0 地平线 → 1 高悬，含月亮混合）
  sunSize: number // 视觉大小（低垂大而暖、高悬小而亮；夜=小月亮）
  warm: number // 暖色权重 0~1（太阳低垂 → 1，高悬/深夜 → 0）
  nightK: number // 夜色权重 0~1（太阳落下 → 月亮接管程度）
  phaseLabel: string // 光色相位（海况面板展示用）
}

const RAD = Math.PI / 180
const LAT = 39.9 * RAD // 北京纬度
const LON = 116.4 // 北京经度（东经）

function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v))
}
function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * clamp(f, 0, 1)
}
function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

/** 北京时间（UTC+8）当前时刻，含秒的小数小时 */
export function beijingHourFrac(utcMs: number): number {
  const d = new Date(utcMs + 8 * 3600e3)
  return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600
}

/** 北京时间 HH:MM */
export function beijingHM(utcMs: number): string {
  const d = new Date(utcMs + 8 * 3600e3)
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
}

/** 北京时间 HH:MM:SS */
export function beijingHMS(utcMs: number): string {
  const d = new Date(utcMs + 8 * 3600e3)
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
}

/** 北京日期的年积日（1~366） */
function dayOfYearBJ(utcMs: number): number {
  const d = new Date(utcMs + 8 * 3600e3)
  const start = Date.UTC(d.getUTCFullYear(), 0, 1)
  const cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  return Math.round((cur - start) / 86400e3) + 1
}

/**
 * 太阳位置（Spencer 公式，忽略大气折射与观测点海拔）。
 * hourFrac 为北京时间小数小时（可被调试参数覆盖成虚拟时刻）；
 * utcMs 只用于确定日期（赤纬随季节变化）。
 */
export function solarAt(hourFrac: number, utcMs: number): SolarState {
  const N = dayOfYearBJ(utcMs)
  const gamma = ((2 * Math.PI) / 365) * (N - 1 + (hourFrac - 12) / 24)

  // Spencer 太阳赤纬（弧度）：夏至 +23.4° ↔ 冬至 -23.4°，决定冬夏日照高低
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma)

  // Spencer 均时差（分钟）：真太阳时与钟表的差，让日出日落不的死板
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.04089 * Math.sin(2 * gamma))

  // 真太阳时 → 时角（正午 0°，每小时 15°）
  const tst = hourFrac + (4 * (LON - 120) + eqTime) / 60
  const H = (tst - 12) * 15 * RAD
  const Hdeg = H / RAD

  // 高度角：sin(α) = sinφ·sinδ + cosφ·cosδ·cosH
  const sinElev = Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(H)
  const elevDeg = Math.asin(clamp(sinElev, -1, 1)) / RAD

  // 天幕横坐标：时角线性映射（日出约 0.05 东边 → 正午 0.5 → 日落 0.95 西边），
  // 冬夏日出日落时角不同，太阳「在屏上的行程」也随之真实变化
  const xSun = clamp(0.5 + Hdeg / 170, 0.04, 0.96)
  const ySun = clamp(sinElev, 0.02, 0.98)
  const sizeSun = 1.05 - clamp(sinElev, 0, 1) * 0.55

  // 夜色权重：太阳落到 -3° 起月亮渐入，-12° 完全接管（民用曙暮光口径）
  const nightK = clamp((-elevDeg - 3) / 9, 0, 1)
  const x01 = lerp(xSun, 0.76, nightK)
  const y01 = lerp(ySun, 0.55, nightK)
  const sunSize = lerp(sizeSun, 0.3, nightK)

  // 暖色权重：太阳贴地平线（|α| 小）最暖，高悬或深藏 → 冷；
  // 26° 窗口让「斜阳/晨光」也带可感知的暖意（直射点低 → 海面转暖）
  const warm = clamp(1.1 - Math.abs(elevDeg) / 26, 0, 1)

  // 光色相位标签（海况面板展示）
  let phaseLabel: string
  if (elevDeg < -12) phaseLabel = "深夜 · 冷月海面"
  else if (elevDeg < -3) phaseLabel = hourFrac < 12 ? "曙色 · 天将明" : "暮色 · 华灯初上"
  else if (elevDeg < 8) phaseLabel = hourFrac < 12 ? "日出金光 · 暖" : "落日金光 · 暖"
  else if (elevDeg < 24) phaseLabel = hourFrac < 12 ? "晨光 · 冷中转暖" : "斜阳 · 暖意渐沉"
  else phaseLabel = "正午 · 天光最盛"

  return { elevDeg, x01, y01, sunSize, warm, nightK, phaseLabel }
}
