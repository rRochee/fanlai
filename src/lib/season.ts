import type { Season } from "@/lib/types"

/**
 * 招聘季文案中枢（Task 26-l）：
 * 切换「秋招 / 春招 / 社招」时，封面刊头、导航、页脚、今日视图的
 * 全部季节措辞都从这里取——杜绝「切了模式页面还写着秋招」的断层。
 */
export interface SeasonMeta {
  /** 刊号行用的季名（如「秋招号」） */
  issueWord: string
  /** 英文季名（页脚版权行） */
  en: string
  /** 一句当季语境的封面定位语（差异化主张，见 26-m） */
  tagline: string
  /** 今日视图副标里的当季形容 */
  dailyWord: string
  /** 名录视图导语里的当季形容 */
  directoryWord: string
}

export const SEASON_META: Record<Season, SeasonMeta> = {
  秋招: {
    issueWord: "秋招号",
    en: "Autumn",
    tagline:
      "每天只收当日新放出的秋招企业，一天一份准时开饭——先看企业，再挑岗位，把工作端上你的餐桌。",
    dailyWord: "秋招",
    directoryWord: "秋招",
  },
  春招: {
    issueWord: "春招号",
    en: "Spring",
    tagline:
      "每天整理当日新放出的春招席位，一天一份准时开饭——先看企业，再挑岗位，赶上春天的这一班。",
    dailyWord: "春招",
    directoryWord: "春招",
  },
  社招: {
    issueWord: "社招号",
    en: "Career",
    tagline:
      "每天放出新开的社会招聘窗口，一天一份准时开饭——先看企业，再谈岗位，把选择权留给自己。",
    dailyWord: "社招",
    directoryWord: "社招",
  },
}

/** 安全取值：未知季名回落秋招 */
export function seasonMeta(season: string | null | undefined): SeasonMeta {
  return SEASON_META[(season ?? "秋招") as Season] ?? SEASON_META["秋招"]
}

/**
 * 产品差异化定位（Task 26-m）：写在封面上的三条「为什么是饭来」。
 * 市面上的校招汇总产品都在做无限信息流；饭来反着做——做减法、做刊物、做陪伴。
 */
export const POSITIONING_POINTS = [
  {
    title: "每日限量",
    desc: "拒绝无限下滑的信息流，一天只送当日新放出的一家一家，读完就能投",
    no: "壹",
  },
  {
    title: "先企业后岗位",
    desc: "看清公司是谁、做什么、稳不稳，再决定把简历交给谁",
    no: "贰",
  },
  {
    title: "投递有迹",
    desc: "记一笔投递、盯紧截止日、漏斗复盘节奏——心态也有古籍与心声墙安放",
    no: "叁",
  },
] as const
