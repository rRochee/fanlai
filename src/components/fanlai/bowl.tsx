import { cn } from "@/lib/utils"

/**
 * 饭碗吉祥物「饭饭」：饭来 = 一碗热饭，找到工作就是端稳一碗饭。
 * Riso 双墨色（松墨绿碗身 + 柿橘描边/蒸汽）随主题变量自动换墨，
 * 四种情绪对应四种场景：idle 默认待客 / cook 同步做饭中 / happy 开饭报喜 / sad 扑空失落。
 * 动画全部走 CSS keyframes（globals.css），prefers-reduced-motion 下自动静止。
 */
export type BowlMood = "idle" | "cook" | "happy" | "sad" | "plain"

const STEAM_PATHS = [
  "M24.5 13.2c-1.9-2.5 1.5-4.1.2-6.9",
  "M32 11.6c1.9-2.7-1.3-4.3.1-7.1",
  "M39.5 13.2c-1.7-2.5 1.7-4.1.5-6.9",
]

export function Bowl({
  mood = "idle",
  size = 28,
  className,
}: {
  mood?: BowlMood
  size?: number
  className?: string
}) {
  const showSteam = mood === "idle" || mood === "cook" || mood === "happy"
  const face = mood === "cook" || mood === "happy" ? "arc" : mood === "sad" ? "droop" : mood === "idle" ? "dot" : null

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      className={cn("shrink-0 overflow-visible", mood === "cook" && "bowl-cook", mood === "happy" && "bowl-happy", className)}
    >
      {/* 蒸汽：柿橘墨 */}
      {showSteam && (
        <g className="bowl-steam" fill="none" stroke="var(--chart-3)" strokeWidth={2.4} strokeLinecap="round">
          {STEAM_PATHS.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
      )}

      {/* 米饭：暖米白 + 谷粒短线 */}
      <g>
        <path
          d="M15.5 30c0-8.6 8-13.6 16.5-13.6S48.5 21.4 48.5 30Z"
          fill="var(--bowl-rice)"
          stroke="var(--bowl-rice-line)"
          strokeWidth={1.4}
        />
        <g stroke="var(--bowl-rice-line)" strokeWidth={1.5} strokeLinecap="round" opacity={0.8}>
          <path d="M24.5 22.5l2.6-1.6" />
          <path d="M33.5 20.8l2.6-.9" />
          <path d="M28.5 25.6l2.6-1.2" />
          <path d="M39 24.2l2.4-1.4" />
        </g>
      </g>

      {/* 碗身：松墨绿 + 柿橘口沿 */}
      <g>
        <path d="M12.5 30h39c0 11.6-8 20-19.5 20s-19.5-8.4-19.5-20Z" fill="var(--primary)" />
        <path d="M12.5 30h39v3.4h-39Z" fill="var(--chart-3)" />
        <path
          d="M25.5 49.4h13v3c0 1.1-.9 2-2 2h-9c-1.1 0-2-.9-2-2Z"
          fill="var(--primary)"
        />
      </g>

      {/* 表情 */}
      {face && (
        <g fill="none" stroke="var(--primary-foreground)" strokeWidth={1.9} strokeLinecap="round">
          {face === "dot" && (
            <>
              <circle cx="26" cy="40.6" r="1.7" fill="var(--primary-foreground)" stroke="none" />
              <circle cx="38" cy="40.6" r="1.7" fill="var(--primary-foreground)" stroke="none" />
              <path d="M29.4 44.6q2.6 2.2 5.2 0" />
            </>
          )}
          {face === "arc" && (
            <>
              <path d="M23.8 41.2q2.2-2.6 4.4 0" />
              <path d="M35.8 41.2q2.2-2.6 4.4 0" />
              {mood === "happy" ? (
                <path d="M27.6 43.8q4.4 4.6 8.8 0" />
              ) : (
                <circle cx="32" cy="45.4" r="1.5" fill="var(--primary-foreground)" stroke="none" />
              )}
            </>
          )}
          {face === "droop" && (
            <>
              <path d="M24 40.2l4 1.6" />
              <path d="M40 40.2l-4 1.6" />
              <path d="M29.4 46.4q2.6-2.4 5.2 0" />
            </>
          )}
        </g>
      )}

      {/* 情绪配件：happy 腮红 / sad 汗滴（柿橘墨点睛） */}
      {mood === "happy" && (
        <g fill="var(--chart-3)" opacity={0.6}>
          <circle cx="21.6" cy="43.8" r="2" />
          <circle cx="42.4" cy="43.8" r="2" />
        </g>
      )}
      {mood === "sad" && (
        <path
          d="M45.4 34.2c1.5 2.2 2.2 3.5 2.2 4.6a2.2 2.2 0 1 1-4.4 0c0-1.1.7-2.4 2.2-4.6Z"
          fill="var(--chart-3)"
        />
      )}
    </svg>
  )
}
