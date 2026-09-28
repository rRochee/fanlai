#!/bin/bash
# Round 9 配图扩充：真实风景 + 抽象混合（串行 + 退避重试，防 429）
cd /home/z/my-project
mkdir -p public/images

gen() {
  local p="$1" o="$2" s="$3"
  for i in 1 2 3; do
    if z-ai image -p "$p" -o "$o" -s "$s" >/dev/null 2>&1; then
      if [ -s "$o" ]; then echo "OK $o"; return 0; fi
    fi
    sleep $((i*10))
  done
  echo "FAIL $o"
  return 1
}

sleep 2
gen "真实摄影：清晨湖面薄雾，远处雪山倒映在平静水面，深蓝色调过渡到淡蓝天空，宁静广阔，低饱和自然风光摄影，高质量，细节丰富" "public/images/scenery-lake-dawn.png" "1344x768"
sleep 5
gen "极简抽象艺术：墨蓝色流动弧线扫过温暖米白宣纸背景，一颗绯红圆点点缀，东方美学，大量留白，深蓝与墨灰笔触，高级感，高质量" "public/images/abstract-ink-arc.png" "1344x768"
sleep 5
gen "真实摄影：黎明时分的城市天际线，淡蓝色晨光中的高楼剪影，薄雾，远景，宁静蓝色调，自然风光摄影，高质量" "public/images/scenery-city-dawn.png" "1344x768"
sleep 5
gen "抽象艺术：玻璃旋转门的折射光斑，透明玻璃质感，淡蓝、暖白与深蓝的流动光影色带，奢华极简风格，柔和渐变，高级质感，高质量" "public/images/abstract-glass-light.png" "864x1152"
sleep 5
gen "真实摄影：晨光透过森林洒在小径上，薄雾，青绿与淡蓝色调，自然风光摄影，宁静治愈，高质量" "public/images/scenery-forest-path.png" "1344x768"
sleep 5
gen "极简抽象艺术：层叠流动的水波纹样，蓝绿色与深蓝渐变，几缕金色与绯红细线，东方美学，大量留白，高质量" "public/images/abstract-waves.png" "1024x1024"
sleep 5
gen "真实摄影：海上日出，太阳从海平面升起，薄雾，暖橙与淡蓝渐变天空，宁静广阔，自然风光摄影，高质量" "public/images/scenery-sea-sunrise.png" "1344x768"

echo "ALL DONE"
