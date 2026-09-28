#!/bin/bash
# 监督循环：直到12张图全部就绪或总时长超30分钟
END=$((SECONDS + 1800))
while [ $SECONDS -lt $END ]; do
  COUNT=$(ls /home/z/my-project/public/images/*.png 2>/dev/null | wc -l)
  if [ "$COUNT" -ge 13 ]; then break; fi
  cd /home/z/my-project && timeout 900 bun run scripts/gen-images.ts >> /dev/null 2>&1
  echo "supervisor: run ended, count=$COUNT" >> scripts/gen-images.log
  sleep 5
done
echo "SUPERVISOR DONE count=$(ls /home/z/my-project/public/images/*.png 2>/dev/null | wc -l)" >> scripts/gen-images.log
