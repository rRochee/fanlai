#!/bin/bash
# 饭来 v3 主视觉：蓝调编辑部（墨蓝/淡蓝/天蓝/红），自信的碗接住飞来的 OFFER
# 串行 + 429 退避重试；输出 public/images/hero-v3.png / hero-dark-v3.png
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/../public/images"
mkdir -p "$OUT"

gen() {
  local prompt="$1" out="$2"
  for i in 1 2 3 4 5 6; do
    echo "[$(date +%H:%M:%S)] try#$i -> $out"
    if z-ai image -p "$prompt" -o "$out" -s 1344x768; then
      if [ -s "$out" ]; then echo "OK: $out"; return 0; fi
    fi
    echo "retry in $((i*12))s (rate limit?)"; sleep $((i*12))
  done
  echo "FAILED: $out"; return 1
}

P_DAY='Bold flat editorial illustration for a fashion magazine poster, one giant confident cheerful blue-and-white porcelain rice bowl character with a proud big smile, rosy cheeks and sparkling determined eyes, wearing a small red beret tilted proudly, catching a shiny red envelope with a wax seal falling from the sky into the bowl, dynamic motion lines, confetti stars and sparkles around, thick ink outlines, risograph print texture, deep navy blue backdrop with one huge sky-blue circle and light-blue color blocks, vivid red accent shapes, playful energetic triumphant mood, poster composition with generous negative space, high quality, detailed'

P_NIGHT='Bold flat editorial illustration, night city scene, one giant confident cheerful rice bowl character under a warm street lamp glow, catching a glowing red envelope with a wax seal falling into the bowl, sparkling stars, deep midnight navy blue background with dark blue color blocks, neon sky-blue accent lines, vivid red accents, thick ink outlines, risograph poster texture, playful triumphant mood, generous negative space, high quality, detailed'

gen "$P_DAY"   "$OUT/hero-v3.png"
sleep 8
gen "$P_NIGHT" "$OUT/hero-dark-v3.png"
echo "ALL DONE"
