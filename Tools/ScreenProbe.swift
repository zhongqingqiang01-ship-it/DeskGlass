import AppKit
import CoreGraphics

let primary = CGMainDisplayID()
print("Primary display ID: \(primary)")
for screen in NSScreen.screens {
    let id = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
    print("\(screen.localizedName) primary=\(id == primary) displayID=\(id) frame=\(screen.frame) visible=\(screen.visibleFrame)")
}
if let windows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] {
    for window in windows where window[kCGWindowOwnerName as String] as? String == "DeskGlass" || window[kCGWindowOwnerName as String] as? String == "桌面工作台" || window[kCGWindowOwnerName as String] as? String == "Dock" {
        print("Window: \(window[kCGWindowOwnerName as String] ?? "") bounds=\(window[kCGWindowBounds as String] ?? "") layer=\(window[kCGWindowLayer as String] ?? "")")
    }
}
