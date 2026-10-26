import AppKit
import SwiftUI

@MainActor final class StageSmokeDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var model: DeskStageModel!
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        let project = URL(fileURLWithPath: CommandLine.arguments[1])
        model = DeskStageModel(assets: project.appendingPathComponent("Resources/Stage"), validates: true)
        model.onValidation = { result in
            switch result {
            case .success(let report):
                do {
                    var cleanReport = report
                    if let preview = cleanReport.removeValue(forKey: "preview") as? String, let encoded = preview.split(separator: ",", maxSplits: 1).last, let png = Data(base64Encoded: String(encoded)) {
                        try png.write(to: project.appendingPathComponent(".build/stage-preview.png"), options: .atomic)
                    }
                    let data = try JSONSerialization.data(withJSONObject: cleanReport, options: [.prettyPrinted, .sortedKeys])
                    try data.write(to: project.appendingPathComponent(".build/stage-validation.json"), options: .atomic)
                    print(String(data: data, encoding: .utf8)!)
                    NSApp.terminate(nil)
                } catch { print("Validation output failed: \(error)"); exit(1) }
            case .failure(let error): print("3D validation failed: \(error)"); exit(1)
            }
        }
        window = NSWindow(contentRect: NSRect(x: 80, y: 160, width: 860, height: 580), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "DeskGlass 3D 验证"
        window.contentView = NSHostingView(rootView: DesktopStageView(model: model))
        window.makeKeyAndOrderFront(nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 90) { print("3D validation timed out"); exit(1) }
    }
}
@main struct StageSmokeMain {
    @MainActor static func main() {
        let app=NSApplication.shared;let delegate=StageSmokeDelegate();app.delegate=delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
