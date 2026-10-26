#!/bin/zsh
set -euo pipefail
cd "${0:A:h}"
mkdir -p .build/ModuleCache
ARCH="${ARCH:-$(uname -m)}"
swiftc -swift-version 5 -module-cache-path "$PWD/.build/ModuleCache" -target "$ARCH-apple-macos14.0" Sources/Stage3D.swift Tools/StageSmoke.swift -o .build/StageSmoke -framework AppKit -framework SwiftUI -framework WebKit
.build/StageSmoke "$PWD"
