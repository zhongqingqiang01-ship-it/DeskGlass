#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
for asset in Resources/Stage/models/*(N); do
  [[ "${asset:t}" == ferrari.js ]] || { print -u2 "Public packaging stopped: unexpected or private model $asset"; exit 1; }
done
[[ "$(cat Resources/Stage/assets.js)" == 'window.DeskGlassStageAssets = ["ferrari", "pet"];' ]] || {
  print -u2 'Public packaging stopped: reset the private asset manifest first.'; exit 1
}
./build.sh
APP="dist/桌面工作台.app"
VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")
ARCH="${ARCH:-$(uname -m)}"
ZIP="DeskGlass-${VERSION}-macos-${ARCH}.zip"
codesign --verify --deep --strict "$APP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "dist/$ZIP"
(cd dist && shasum -a 256 "$ZIP" > "$ZIP.sha256")
print "Release files: dist/$ZIP and dist/$ZIP.sha256"
