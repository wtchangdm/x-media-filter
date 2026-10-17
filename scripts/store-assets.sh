#!/bin/sh
# Optional local artwork preparation; use existing pixels, never add text or graphics.
set -eu
cd "$(dirname "$0")/.."
mkdir -p assets/store/exports

# Crop the supplied square cat to 11:7, keeping its face; then resize proportionally.
ffmpeg -v error -y -i assets/store/marquee-grumpy-cat.png \
  -vf 'crop=1254:798:0:120,scale=440:280:flags=lanczos,format=rgb24' -frames:v 1 \
  assets/store/exports/small-promo-440x280.png
# The supplied wide image is already almost 5:2; trim only three columns/one row.
ffmpeg -v error -y -i assets/store/marquee-media-filter.png \
  -vf 'crop=1980:792:1:0,scale=1400:560:flags=lanczos,format=rgb24' -frames:v 1 \
  assets/store/exports/marquee-media-filter-1400x560.png
# Center the intact popup between equal strips of its existing document background.
ffmpeg -v error -y -i assets/store/captures/popup-0.1.0.png \
  -filter_complex '[0:v]format=rgb24,split=3[a][b][c];[a]crop=376:920:720:0[left];[b]crop=720:920:0:0[ui];[c]crop=376:920:1096:0[right];[left][ui][right]hstack=inputs=3,scale=1280:800:flags=lanczos,format=rgb24' -frames:v 1 \
  assets/store/exports/screenshot-settings-1280x800.png
