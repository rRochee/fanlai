/**
 * 饭来的厨房微文案。
 * 同步情报对用户来说是一个「做饭」的等待过程——阶段文案让长耗时可感知、可预期，
 * 避免点了按钮像石沉大海（这正是「点了没反应」体感的根源之一）。
 */

/** 同步阶段文案：按已耗秒数取当前阶段（确定性计算，无需额外定时器） */
const SYNC_PHASES: { at: number; text: string }[] = [
  { at: 0, text: "正在翻今天的菜单…" },
  { at: 9, text: "跑到各家门口打探消息…" },
  { at: 20, text: "后厨正在猛火翻炒…" },
  { at: 38, text: "把情报过筛，滤掉旧闻…" },
  { at: 60, text: "摆盘装碗，马上开饭…" },
]

export function syncPhaseText(elapsedSec: number): string {
  let text = SYNC_PHASES[0].text
  for (const p of SYNC_PHASES) {
    if (elapsedSec >= p.at) text = p.text
  }
  return text
}
