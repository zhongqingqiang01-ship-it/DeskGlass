import AppKit
import SwiftUI

// This documentation preview uses the real SwiftUI panels with disposable demonstration data.
// It never captures the user's screen or reads their workspace.
@MainActor final class PreviewDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var fixture: URL!
    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            NSApp.setActivationPolicy(.accessory)
            let root = URL(fileURLWithPath: CommandLine.arguments[1])
            fixture = FileManager.default.temporaryDirectory.appendingPathComponent("DeskGlass-preview-" + UUID().uuidString)
            let folder = fixture.appendingPathComponent("常用资料")
            for name in ["设计灵感", "项目草稿", "参考素材"] {
                try FileManager.default.createDirectory(at: folder.appendingPathComponent(name), withIntermediateDirectories: true)
            }
            try Data("DeskGlass demonstration fixture.".utf8).write(to: folder.appendingPathComponent("本周计划.txt"))
            var prefs = Preferences()
            prefs.folders = [FolderPin(path: folder.path)]
            prefs.tasks = [LocalTask(title: "整理今天的工作安排", due: Date().addingTimeInterval(3600)),
                           LocalTask(title: "收集新项目的参考资料"), LocalTask(title: "给自己留一点休息时间")]
            let directory = fixture.appendingPathComponent("data")
            try DiskStore(directory: directory).save(prefs)
            let model = WorkspaceModel(directory: directory)
            let image = NSImage(contentsOf: root.appendingPathComponent(".build/stage-preview.png")) ?? NSImage()
            let content = ZStack {
                LinearGradient(colors: [Color(red:0.08,green:0.14,blue:0.22), Color(red:0.15,green:0.31,blue:0.36),
                                        Color(red:0.31,green:0.24,blue:0.32)], startPoint:.topLeading,endPoint:.bottomTrailing)
                Circle().fill(Color(red:0.42,green:0.57,blue:0.55).opacity(0.32)).frame(width:850,height:850).blur(radius:90).offset(x:-290,y:280)
                QuoteView(model:model).frame(width:420,height:280).position(x:275,y:185)
                Image(nsImage:image).resizable().scaledToFit().frame(width:890,height:600).position(x:470,y:650)
                SidebarView(model:model).frame(width:500,height:944).position(x:1160,y:500)
                VStack(alignment:.leading,spacing:7) {
                    Text("DeskGlass").font(.system(size:18,weight:.medium))
                    Text("桌面工作台 · 演示数据").font(.system(size:12))
                }.foregroundStyle(.white.opacity(0.7)).frame(maxWidth:.infinity,maxHeight:.infinity,alignment:.bottomLeading).padding(30)
            }.frame(width:1440,height:1000).preferredColorScheme(.dark)
            let host = NSHostingView(rootView:content)
            host.frame = NSRect(x:0,y:0,width:1440,height:1000)
            window = NSWindow(contentRect:host.frame,styleMask:[.borderless],backing:.buffered,defer:false)
            window.contentView=host;window.orderFrontRegardless()
            DispatchQueue.main.asyncAfter(deadline:.now()+1) {
                host.layoutSubtreeIfNeeded()
                guard let bitmap=host.bitmapImageRepForCachingDisplay(in:host.bounds) else { exit(1) }
                host.cacheDisplay(in:host.bounds,to:bitmap)
                do {
                    let output=root.appendingPathComponent("docs/images/overview.png")
                    try FileManager.default.createDirectory(at:output.deletingLastPathComponent(),withIntermediateDirectories:true)
                    guard let data=bitmap.representation(using:.png,properties:[:]) else { exit(1) }
                    try data.write(to:output)
                    try FileManager.default.removeItem(at:self.fixture)
                    print("Documentation preview saved using isolated demonstration data.")
                    NSApp.terminate(nil)
                } catch { print(error);exit(1) }
            }
        } catch { print(error);exit(1) }
    }
}
@main struct PreviewMain {
    @MainActor static func main() {
        let app=NSApplication.shared;let delegate=PreviewDelegate();app.delegate=delegate
        withExtendedLifetime(delegate){app.run()}
    }
}
