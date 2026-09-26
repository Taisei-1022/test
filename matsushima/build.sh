#!/bin/sh
# Wrap the artifact page fragment into a standalone HTML document for static hosting.
cd "$(dirname "$0")"
{ printf '<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">\n'; cat game.html; printf '\n</html>\n'; } > index.html
