#!/bin/zsh
set -euo pipefail
cd "${0:A:h}"
mkdir -p .build/ModuleCache dist
ARCH="${ARCH:-$(uname -m)}"
[[ "$ARCH" == arm64 || "$ARCH" == x86_64 ]] || { print -u2 "Unsupported architecture: $ARCH"; exit 1; }
APP="${PWD}/dist/桌面工作台.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -swift-version 5 -O -module-cache-path "$PWD/.build/ModuleCache" -target "$ARCH-apple-macos14.0" Sources/*.swift -o "$APP/Contents/MacOS/DeskGlass" -framework AppKit -framework SwiftUI -framework EventKit -framework Carbon -framework WebKit
cp Resources/Info.plist "$APP/Contents/Info.plist"
test -s Resources/Stage/scene.bundle.js
rm -rf "$APP/Contents/Resources/Stage"
cp -R Resources/Stage "$APP/Contents/Resources/"
cp LICENSE "$APP/Contents/Resources/Stage/licenses/DeskGlass-MIT.txt"
cp THIRD_PARTY_NOTICES.md "$APP/Contents/Resources/Stage/licenses/THIRD_PARTY_NOTICES.md"
codesign --force --sign - --identifier local.deskglass.workbench "$APP"
print "已构建：$APP"
