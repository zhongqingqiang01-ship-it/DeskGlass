#!/bin/zsh
set -euo pipefail
cd "${0:A:h}"
mkdir -p .build/ModuleCache
ARCH="${ARCH:-$(uname -m)}"
swiftc -swift-version 5 -module-cache-path "$PWD/.build/ModuleCache" -target "$ARCH-apple-macos14.0" Sources/Core.swift Sources/WorkspaceModel.swift Tests/Main.swift -o .build/DeskGlassTests -framework AppKit -framework SwiftUI -framework EventKit
.build/DeskGlassTests
