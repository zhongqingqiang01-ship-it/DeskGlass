#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
[[ -s .build/stage-preview.png ]] || { print -u2 'Run ./test-stage.sh before generating the documentation preview.'; exit 1; }
mkdir -p .build/ModuleCache
swiftc -swift-version 5 -module-cache-path "$PWD/.build/ModuleCache" Sources/Core.swift Sources/WorkspaceModel.swift Sources/Views.swift Tools/Preview.swift -o .build/DeskGlassPreview -framework AppKit -framework SwiftUI -framework EventKit
.build/DeskGlassPreview "$PWD"
