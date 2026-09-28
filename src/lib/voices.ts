/**
 * 秋招心声 · 「同路人」（Task 25-g）
 * 来自社交平台（脉脉 / 小红书 / 微博 / 牛客等）公开讨论里常见的声音，
 * 做匿名化摘编：不署名、不改事实梗概、抹去一切可识别信息。
 * 三种声部：吐槽（真实才有力）、鼓励（撑住彼此）、清醒（少走弯路）。
 */
export interface Voice {
  text: string
  tag: "吐槽" | "鼓励" | "清醒"
  persona: string
}

export const VOICES: Voice[] = [
  // ── 吐槽：先承认难，才有人愿意听你说下去 ──
  { text: "网申填了两小时，点提交那一刻系统崩了。", tag: "吐槽", persona: "一位凌晨还在填表的应届生" },
  { text: "投了 80 家，已读不回 76 家，剩下 4 家在走流程。", tag: "吐槽", persona: "一位数着已读的求职者" },
  { text: "笔试考行测，面试聊社团，就是没人问我投的岗位。", tag: "吐槽", persona: "一位怀疑人生的候选人" },
  { text: "「我们会尽快回复」——至今三个月了。", tag: "吐槽", persona: "一位还在等回复的候选人" },
  { text: "银行要硕士起步，快消要三段大厂实习，我卡在中间。", tag: "吐槽", persona: "一位夹缝里的本科生" },
  { text: "三面完说回去等通知，第二天岗位就撤了。", tag: "吐槽", persona: "一位经历过鬼故事的应聘者" },
  { text: "AI 面试官问我为什么想来，我对着摄像头笑了十秒。", tag: "吐槽", persona: "一位和算法对话的人类" },
  // ── 鼓励：撑住彼此的就是这些瞬间 ──
  { text: "第 43 封拒信之后那一封，是 offer。真的，别停。", tag: "鼓励", persona: "一位刚上岸的过来人" },
  { text: "秋招像等一班很久不来的地铁，一来就是两三班。", tag: "鼓励", persona: "一位同时握着两份 offer 的人" },
  { text: "把简历改成一句话讲得清的故事之后，面试多了起来。", tag: "鼓励", persona: "一位改了 11 版简历的人" },
  { text: "厚着脸皮找学长内推那天，是我秋招的转折点。", tag: "鼓励", persona: "一位社恐但成功了的应届生" },
  { text: "每天固定投 5 家、复盘 30 分钟，两个月后来了。", tag: "鼓励", persona: "一位相信节奏的执行派" },
  { text: "被拒不代表你差，只是这家庙太小，或时间不对。", tag: "鼓励", persona: "一位看开的学长" },
  // ── 清醒：少走弯路的真话 ──
  { text: "秋招是信息战：同样一个月，海投和精准狙击结果差很远。", tag: "清醒", persona: "一位观察了两届秋招的博主" },
  { text: "先看企业再挑岗位，真的能省一半力气。", tag: "清醒", persona: "一位吃过亏的学姐" },
  { text: "别把一家公司当全部答案，你手里有 30 次机会。", tag: "清醒", persona: "一位理性派求职者" },
  { text: "实习留用和秋招转正两条路，早点想清楚走哪条。", tag: "清醒", persona: "一位双线作战的人" },
  { text: "心态崩了先去睡觉，简历明天再改，世界照转。", tag: "清醒", persona: "一位学会休息的过来人" },
]

/** 声部对应的展示色（CSS 变量名） */
export const VOICE_TAG_STYLE: Record<Voice["tag"], { dot: string; chip: string }> = {
  吐槽: { dot: "var(--crimson)", chip: "text-[color:var(--crimson-deep)]" },
  鼓励: { dot: "var(--teal)", chip: "text-[color:var(--teal-deep)]" },
  清醒: { dot: "var(--powder)", chip: "text-[color:var(--powder)]" },
}

/** 把 18 条心声均分成三列（列内保持原有交错节奏） */
export function voiceColumns(): [Voice[], Voice[], Voice[]] {
  const cols: [Voice[], Voice[], Voice[]] = [[], [], []]
  VOICES.forEach((v, i) => cols[i % 3].push(v))
  return cols
}
