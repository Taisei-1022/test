#!/bin/sh
# Package the game for the Vappa mini-arcade: writes <arcade>/games/matsushima/.
# Usage: ./build-arcade.sh path/to/arcade
set -e
cd "$(dirname "$0")"
OUT="$1/games/matsushima"; mkdir -p "$OUT"
{
  printf '<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n'
  printf '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">\n'
  printf '<script src="../../js/arcade-sdk.js?v=2"></script>\n'
  sed 's|https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js|three.min.js|' game.html
  printf '\n</html>\n'
} > "$OUT/index.html"
cp height.png photo.jpg places.json three.min.js "$OUT/"
[ -f thumb.png ] && cp thumb.png "$OUT/"
echo "wrote $OUT"
