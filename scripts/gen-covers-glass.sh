#!/bin/bash
# 饭来 Task 23-e：亚克力玻璃质感 + 渐变风景封面（亮/暗）+ 通用辽阔风景图
# 串行生成（一张成功再下一张），调用间隔 25s 防 429；
# 失败/429 走指数退避：60s → 120s → 180s，最多重试 3 次
# 输出 public/images/cover-glass-light.jpg / cover-glass-dark.jpg / scenery-valley.jpg（宽幅 1344x768）
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/../public/images"
mkdir -p "$OUT"

gen() {
  local prompt="$1" out="$2"
  local waits=(0 60 120 180)   # 首次不等，失败后 60/120/180s 退避
  for i in 0 1 2 3; do
    if [ "${waits[$i]}" -gt 0 ]; then
      echo "[$(date +%H:%M:%S)] backoff ${waits[$i]}s before retry#$i -> $out"
      sleep "${waits[$i]}"
    fi
    echo "[$(date +%H:%M:%S)] attempt#$((i+1)) -> $out"
    if z-ai image -p "$prompt" -o "$out" -s 1344x768; then
      if [ -s "$out" ]; then
        echo "[$(date +%H:%M:%S)] OK: $out ($(stat -c%s "$out") bytes)"
        return 0
      fi
    fi
    echo "[$(date +%H:%M:%S)] attempt#$((i+1)) failed"
  done
  echo "[$(date +%H:%M:%S)] FAILED (all 4 attempts): $out"
  return 1
}

# 1) 亮色主题封面底图：亚克力玻璃质感 + 晨光渐变天空，中下部大面积干净渐变留白（供玻璃板叠标题）
P_LIGHT='Vast sky gradient landscape in soft morning light, warm pale golden sunlight glow at the very top, sky blue and pale cyan tones across the middle, gentle pink and apricot dawn glow near the bottom horizon, soft layered flowing sea of clouds concentrated along the upper edges, minimal distant mountain silhouettes hugging the far horizon line, large area of pure clean soft gradient negative space in the lower middle of the frame, airy luminous haze, smooth glossy glass-like sheen, frosted acrylic glass texture, ultra minimal premium aesthetic, abstract landscape photography, serene and expansive mood, key elements only at top and edges, no text, no people, no logo'

# 2) 暗色主题封面底图：墨蓝到深蓝的丝滑夜空渐变 + 极光/月光银边，中下部深邃留白
P_DARK='Night deep blue gradient landscape, silky smooth gradient from ink blue at top to deep navy blue below, one thin elegant streak of teal green aurora and a silver moonlit rim, low quiet starfield, moonlit layers of soft clouds near the upper edge, distant minimal mountain silhouettes at the horizon, large area of deep clean gradient negative space in the lower middle of the frame, smooth glossy sheen like polished glass, frosted acrylic texture, ultra minimal premium aesthetic, abstract landscape photography, serene and vast, key elements only at top and edges, no text, no people, no logo'

# 3) 通用辽阔风景插画：草原山谷 + 大积云，叙事层/空态区用
P_VALLEY='Vast open grassland valley landscape, blue sky with big fluffy cumulus clouds, transparent clear sunlight, wide horizon with strong depth and perspective, cinematic composition, soft early morning light, natural realistic photography style, lush green meadow rolling toward distant mountains, premium quality, no text, no people, no buildings'

gen "$P_LIGHT" "$OUT/cover-glass-light.jpg"; R1=$?
sleep 25
gen "$P_DARK"  "$OUT/cover-glass-dark.jpg";  R2=$?
sleep 25
gen "$P_VALLEY" "$OUT/scenery-valley.jpg";   R3=$?

echo "ALL DONE light=$R1 dark=$R2 valley=$R3"
