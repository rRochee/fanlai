// 求职节奏月历 · 前端适配层（Task 28-e2 · 饭来情报站）
// 节奏数据本体在 rhythm.ts（28-e 建的三季一套：秋招 / 春招 / 社招，每月主题 + 三件事）。
// 这里只做视图需要的加工：展开成 1-12 月的完整月历、标出当前月、
// 给「该季没有节奏安排的月份」补一套通用的休整事项——淡显呈现，不喧宾夺主。

import { RHYTHM_BY_SEASON, type MonthRhythm } from "./rhythm"

export interface CareerRhythmMonth {
  /** 1-12 */
  month: number
  /** 当月主题，如「网申黄金期」 */
  title: string
  /** 本月该做的三件事 */
  items: string[]
  /** 当前月（高亮） */
  active: boolean
  /** 是否属于所选季节的节奏月（false → 休整月，更淡） */
  inSeason: boolean
}

/** 休整月的通用三件事（该季没排到的月份用，不与正式节奏抢戏） */
const IDLE_MONTH: MonthRhythm = {
  title: "休整月 · 盘点蓄力",
  items: ["把上一季的得失写成三条教训", "简历里的成果换成数据说话", "给下一季先列三家企业"],
}

/**
 * 展开某季节的 12 个月节奏月历。
 * @param season 秋招 / 春招 / 社招（跟随导航的季节状态，缺省回退秋招）
 * @param today  YYYY-MM-DD（上海日期，用于高亮当前月）
 */
export function careerRhythmMonths(season: string, today: string): CareerRhythmMonth[] {
  const table = RHYTHM_BY_SEASON[season] ?? RHYTHM_BY_SEASON["秋招"]
  const current = Number(today.slice(5, 7))
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1
    const rhythm: MonthRhythm | undefined = table[month]
    return {
      month,
      title: rhythm?.title ?? IDLE_MONTH.title,
      items: rhythm ? [...rhythm.items] : [...IDLE_MONTH.items],
      active: month === current,
      inSeason: Boolean(rhythm),
    }
  })
}
