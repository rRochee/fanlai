#!/bin/bash
# 饭来 bot 配图生成（串行 + 限速重试，避免 429）
OUT=/home/z/my-project/public/images
LOG=/home/z/my-project/scripts/gen-images.log
STYLE="minimalist flat illustration, thin elegant line art, muted pine green and warm ivory color palette, generous negative space, calm editorial magazine style, soft paper texture, no text, no letters, no words"

gen () {
  local name=$1; local subject=$2; local size=$3
  # 已存在则跳过
  if [ -s "$OUT/$name.png" ]; then echo "SKIP $name" >> "$LOG"; return 0; fi
  for i in 1 2 3 4 5; do
    if z-ai image -p "$subject, $STYLE" -o "$OUT/$name.png" -s "$size" >> "$LOG" 2>&1; then
      echo "OK $name" >> "$LOG"
      return 0
    fi
    echo "RETRY $name attempt=$i" >> "$LOG"
    sleep $((i * 20))
  done
  echo "FAIL $name" >> "$LOG"
}

gen hero "a steaming rice bowl beside a folded morning newspaper and a small sprig of leaves on a warm ivory desk, top view" 1344x768
gen cover-retail "a minimal storefront with striped awning, a shopping bag and a small shopping cart" 1344x768
gen cover-manufacturing "a precise robotic arm above an assembly line with gear outlines" 1344x768
gen cover-electronics "a smartphone, wireless earbuds and a smartwatch arranged on ivory background" 1344x768
gen cover-hardware "a flying camera drone and a gimbal with small sensor chips floating around" 1344x768
gen cover-supplychain "stacked shipping containers, a small forklift and a dashed route line across a warehouse floor" 1344x768
gen cover-trade "a cargo ship at a quiet harbor with two cranes and stacked containers, distant horizon" 1344x768
gen cover-health "a stethoscope forming a gentle curve beside a green leaf and a subtle medical cross" 1344x768
gen cover-industrial "solar panels, a wind turbine and a battery cell with a small circuit motif" 1344x768
gen cover-internet "a minimal browser window with code brackets and floating chat bubbles" 1344x768
gen cover-auto "a sleek electric car silhouette with a charging bolt and road line" 1344x768
gen cover-consumer "minimal product boxes, a perfume bottle and a sneaker with a shopping tag" 1344x768
echo "ALL DONE" >> "$LOG"
