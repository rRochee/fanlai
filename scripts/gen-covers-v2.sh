#!/bin/bash
# 饭来 v3 新行业封面（非理工科行业）：串行 + 429 退避重试
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/../public/images"
mkdir -p "$OUT"

gen() {
  local prompt="$1" out="$2"
  for i in 1 2 3 4 5; do
    echo "[$(date +%H:%M:%S)] try#$i -> $out"
    if z-ai image -p "$prompt" -o "$out" -s 1152x864; then
      [ -s "$out" ] && { echo "OK: $out"; return 0; }
    fi
    echo "retry in $((i*10))s"; sleep $((i*10))
  done
  echo "FAILED: $out"; return 1
}

STYLE='flat editorial illustration with thick ink outlines, deep navy blue and sky-blue palette with vivid red accents, risograph poster texture, generous negative space, high quality, detailed'

gen "a bright modern classroom scene with books and a graduation cap, warm morning light" " $OUT/cover-education-v2.png"; sleep 5
gen "a film camera, microphone and newspaper stack on a studio desk, spotlight glow" "$OUT/cover-media-v2.png"; sleep 5
gen "a balance scale, law books and a briefcase on a marble desk, elegant office light" "$OUT/cover-legal-v2.png"; sleep 5
gen "a city skyline under construction with cranes and blueprints, dawn light" "$OUT/cover-estate-v2.png"; sleep 5
gen "an electric power transmission tower and green energy grid over vast land, sunrise" "$OUT/cover-public-v2.png"; sleep 5
gen "an airplane flying over clouds toward a resort hotel and palm trees, broad sky" "$OUT/cover-travel-v2.png"
echo "ALL DONE"
