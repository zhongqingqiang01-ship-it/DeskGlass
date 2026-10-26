#!/bin/zsh
set -euo pipefail
cd "${0:A:h}"
if [[ ! -x "dist/桌面工作台.app/Contents/MacOS/DeskGlass" ]]; then ./build.sh; fi
open "dist/桌面工作台.app"
