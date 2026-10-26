import AppKit
import SwiftUI
import Carbon

final class DesktopPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate {
    var model: WorkspaceModel!
    var sidebar: DesktopPanel!
    var quote: DesktopPanel!
    var settings: NSWindow?
    var status: NSStatusItem!
    var hotKey: EventHotKeyRef?
    var floating = false
    var isVisible = true
    var screenObserver: NSObjectProtocol?
    var lockMenuItem: NSMenuItem?
    var objectStage: DesktopPanel?
    var stageModel: DeskStageModel!
    var stageMenuItem: NSMenuItem?
    private var desktopLevel: NSWindow.Level { NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1) }
    private var baseLevel: NSWindow.Level { floating ? .floating : desktopLevel }
    private var primaryScreen: NSScreen? {
        NSScreen.screens.first { screen in
            (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == CGMainDisplayID()
        } ?? NSScreen.screens.first
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        model = WorkspaceModel()
        model.onSettings = { [weak self] in self?.showSettings() }
        model.onAutoSize = { [weak self] in self?.autoSize() }
        model.onPositionLockChange = { [weak self] locked in self?.applyPositionLock(locked) }
        let visible = primaryScreen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        sidebar = panel(name: "DeskGlass.Sidebar", frame: NSRect(x: visible.maxX - 415, y: visible.minY + 18, width: 400, height: min(780, visible.height - 36)), view: SidebarView(model: model))
        quote = panel(name: "DeskGlass.DailyQuote", frame: quoteFrame(in: visible), view: QuoteView(model: model))
        sidebar.minSize = NSSize(width: min(380, visible.width - 36), height: min(740, visible.height - 36))
        sidebar.maxSize = NSSize(width: visible.width - 24, height: visible.height - 24)
        if !UserDefaults.standard.bool(forKey: "DeskGlass.AdaptiveLayoutV1") {
            sidebar.setFrame(WorkbenchSizing.fitted(in: visible), display: true)
            sidebar.saveFrame(usingName: "DeskGlass.Sidebar")
            UserDefaults.standard.set(true, forKey: "DeskGlass.AdaptiveLayoutV1")
        }
        quote.minSize = NSSize(width: 360, height: 250)
        quote.maxSize = NSSize(width: 900, height: 400)
        // Older builds let SwiftUI stretch the quote down into the Dock area, so AppKit shifted it up on every launch (and
        // the exhibit, which reaches up to its first line, with it): put such a frame back at the usual place and size.
        if quote.frame.height > quote.maxSize.height { quote.setFrame(quoteFrame(in: visible), display: false) }
        applyLevels(); sidebar.orderFrontRegardless(); quote.orderFrontRegardless()
        stageModel = DeskStageModel()
        stageModel.onVisibility = { [weak self] shown in self?.setStageVisible(shown) }
        setStageVisible(stageModel.shown)
        screenObserver = NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.resetPositions() }
        }
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        status.button?.image = NSImage(systemSymbolName: "rectangle.3.group", accessibilityDescription: "桌面工作台")
        let menu = NSMenu()
        menu.addItem(item("显示 / 隐藏工作台", #selector(toggleVisible)))
        menu.addItem(item("呼出 / 回到桌面（⌃⌥空格）", #selector(toggleFloating)))
        menu.addItem(item("移回主屏幕", #selector(resetPositions)))
        menu.addItem(item("自动拉伸工作台", #selector(autoSize)))
        let stageItem = item(stageModel.shown ? "隐藏桌面展品" : "显示桌面展品", #selector(toggleStage))
        stageMenuItem = stageItem; menu.addItem(stageItem)
        let lockItem = item(model.positionsLocked ? "解锁工作台位置" : "锁定工作台位置", #selector(togglePositionLock))
        lockMenuItem = lockItem; menu.addItem(lockItem)
        menu.addItem(.separator())
        menu.addItem(item("设置…", #selector(showSettings)))
        menu.addItem(item("刷新待办", #selector(refresh)))
        menu.addItem(.separator())
        menu.addItem(item("退出工作台", #selector(quit)))
        status.menu = menu
        let main = NSMenu()
        let appItem = NSMenuItem(); let appMenu = NSMenu()
        let settingsItem = item("工作台设置…", #selector(showSettings)); settingsItem.keyEquivalent = ","; appMenu.addItem(settingsItem)
        let quitItem = item("退出桌面工作台", #selector(quit)); quitItem.keyEquivalent = "q"; appMenu.addItem(quitItem)
        appMenu.insertItem(item("查看桌面展品", #selector(focusStage)), at: 1)
        appItem.submenu = appMenu; main.addItem(appItem)
        let editItem = NSMenuItem(); let editMenu = NSMenu(title: "编辑")
        for (title, action, key) in [("撤销", Selector(("undo:")), "z"), ("剪切", #selector(NSText.cut(_:)), "x"), ("复制", #selector(NSText.copy(_:)), "c"), ("粘贴", #selector(NSText.paste(_:)), "v"), ("全选", #selector(NSText.selectAll(_:)), "a")] {
            editMenu.addItem(NSMenuItem(title: title, action: action, keyEquivalent: key))
        }
        editItem.submenu = editMenu; main.addItem(editItem); NSApp.mainMenu = main
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, pointer in
            guard let pointer else { return OSStatus(eventNotHandledErr) }
            let delegate = Unmanaged<AppDelegate>.fromOpaque(pointer).takeUnretainedValue()
            DispatchQueue.main.async { delegate.toggleFloating() }
            return noErr
        }, 1, &spec, Unmanaged.passUnretained(self).toOpaque(), nil)
        let hotID = EventHotKeyID(signature: OSType(0x44475353), id: 1)
        RegisterEventHotKey(49, UInt32(controlKey | optionKey), hotID, GetApplicationEventTarget(), 0, &hotKey)
        if !UserDefaults.standard.bool(forKey: "DeskGlass.DidWelcome") {
            UserDefaults.standard.set(true, forKey: "DeskGlass.DidWelcome")
            DispatchQueue.main.async { self.showSettings() }
        }
    }
    private func item(_ title: String, _ action: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: ""); item.target = self; return item
    }
    private func panel<V: View>(name: String, frame: NSRect, view: V) -> DesktopPanel {
        let panel = DesktopPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel, .resizable], backing: .buffered, defer: false)
        panel.title = name.contains("Sidebar") ? "桌面工作台" : (name.contains("DisplayObject") ? "桌面展品" : "每日寄语")
        panel.isFloatingPanel = false; panel.hidesOnDeactivate = false; panel.becomesKeyOnlyIfNeeded = true
        panel.backgroundColor = .clear; panel.isOpaque = false; panel.hasShadow = false; panel.level = desktopLevel
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        panel.isMovableByWindowBackground = !model.positionsLocked
        panel.isMovable = !model.positionsLocked
        let host = NSHostingView(rootView: view)
        // The app sizes every panel itself. SwiftUI's own minimum must not stretch it: measured at zero width the quote
        // wraps one character per line and would pull its panel ~800 pt down the screen.
        host.sizingOptions = []
        panel.contentView = host
        panel.appearance = NSAppearance(named: .darkAqua)
        panel.setFrameAutosaveName(name)
        _ = panel.setFrameUsingName(name)
        if let visible = primaryScreen?.visibleFrame, !visible.contains(panel.frame) { panel.setFrame(frame, display: false) }
        return panel
    }
    func applyPositionLock(_ locked: Bool) {
        sidebar?.isMovableByWindowBackground = !locked
        sidebar?.isMovable = !locked
        quote?.isMovableByWindowBackground = !locked
        quote?.isMovable = !locked
        objectStage?.isMovable = !locked
        objectStage?.isMovableByWindowBackground = false
        lockMenuItem?.title = locked ? "解锁工作台位置" : "锁定工作台位置"
    }
    @objc func togglePositionLock() { model.positionsLocked.toggle() }
    @objc func toggleVisible() {
        isVisible.toggle()
        if isVisible { sidebar.orderFrontRegardless(); quote.orderFrontRegardless() }
        else { sidebar.orderOut(nil); quote.orderOut(nil) }
        setStageVisible(stageModel.shown)
    }
    @objc func toggleFloating() {
        floating.toggle(); isVisible = true
        applyLevels()
        sidebar.orderFrontRegardless(); quote.orderFrontRegardless()
        setStageVisible(stageModel.shown)
    }
    /// The daily quote sits one level above the exhibit, which reaches up behind its text: the quote's text and button stay
    /// on top and clickable, and its transparent area lets clicks through (the exhibit's web view catches every click in
    /// its frame, so it must not cover the quote).
    private func applyLevels() {
        sidebar.level = baseLevel; objectStage?.level = baseLevel
        quote.level = NSWindow.Level(rawValue: baseLevel.rawValue + 1)
    }
    @objc func resetPositions() {
        guard let visible = primaryScreen?.visibleFrame else { return }
        sidebar.minSize = NSSize(width: min(380, visible.width - 36), height: min(740, visible.height - 36))
        sidebar.maxSize = NSSize(width: visible.width - 24, height: visible.height - 24)
        sidebar.setFrame(WorkbenchSizing.fitted(in: visible), display: true)
        quote.setFrame(quoteFrame(in: visible), display: true)
        isVisible = true; sidebar.orderFrontRegardless(); quote.orderFrontRegardless()
        objectStage?.setFrame(stageFrame(in: visible), display: true)
        setStageVisible(stageModel.shown)
    }
    @objc func autoSize() {
        guard let visible = primaryScreen?.visibleFrame else { return }
        sidebar.setFrame(WorkbenchSizing.fitted(in: visible), display: true, animate: true)
        sidebar.saveFrame(usingName: "DeskGlass.Sidebar")
        isVisible = true; sidebar.orderFrontRegardless()
    }
    private func quoteFrame(in visible: NSRect) -> NSRect { NSRect(x: visible.minX + 50, y: visible.maxY - 390, width: 420, height: 280) }
    private func stageFrame(in visible: NSRect) -> NSRect {
        let available = max(260, sidebar.frame.minX - visible.minX - 60)
        // Tall exhibits use the full height from the bottom of the screen up to the first line of the daily quote, ~40 pt
        // below its panel's top (the panel may have been stretched further down, transparently); the quote stays on top.
        let ceiling = quote.frame.minX < visible.minX + available && quote.isVisible ? quote.frame.maxY - 40 : visible.maxY - 24
        let height = min(visible.height - 20, max(460, ceiling - visible.minY - 10))
        return NSRect(x: visible.minX + 24, y: visible.minY + 10, width: min(1180, available), height: height)
    }
    func setStageVisible(_ shown: Bool) {
        stageMenuItem?.title = stageModel.shown ? "隐藏桌面展品" : "显示桌面展品"
        guard shown && isVisible, let visible = primaryScreen?.visibleFrame else {
            stageModel.renderVisible = false; objectStage?.orderOut(nil); return
        }
        if objectStage == nil {
            let frame = stageFrame(in: visible)
            let stage = panel(name: "DeskGlass.DisplayObject", frame: frame, view: DesktopStageView(model: stageModel))
            // One-time move to the larger exhibit area reaching up to the quote's text (older builds stopped below it).
            if !UserDefaults.standard.bool(forKey: "DeskGlass.StageLayoutV5") {
                stage.setFrame(frame, display: false); stage.saveFrame(usingName: "DeskGlass.DisplayObject")
                UserDefaults.standard.set(true, forKey: "DeskGlass.StageLayoutV5")
            }
            stage.isMovableByWindowBackground = false
            stage.minSize = NSSize(width: min(360, frame.width), height: min(380, frame.height))
            stage.maxSize = NSSize(width: visible.width, height: visible.height)
            objectStage = stage
            // Pause rendering while other windows completely cover the exhibit; the pet otherwise animates continuously.
            NotificationCenter.default.addObserver(forName: NSWindow.didChangeOcclusionStateNotification, object: stage, queue: .main) { [weak self, weak stage] _ in
                MainActor.assumeIsolated {
                    guard let self, let stage, self.stageModel.shown, self.isVisible else { return }
                    self.stageModel.renderVisible = stage.occlusionState.contains(.visible)
                }
            }
        }
        stageModel.renderVisible = true
        applyLevels()
        objectStage?.orderFrontRegardless()
    }
    @objc func toggleStage() { stageModel.shown.toggle() }
    @objc func focusStage() {
        stageModel.shown = true
        NSApp.activate(ignoringOtherApps: true)
        objectStage?.makeKeyAndOrderFront(nil)
    }
    @objc func showSettings() {
        if settings == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 500, height: 720), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            window.title = "桌面工作台 · 设置"; window.isReleasedWhenClosed = false
            window.contentView = NSHostingView(rootView: SettingsView(model: model)); window.appearance = NSAppearance(named: .darkAqua)
            if let visible = primaryScreen?.visibleFrame { window.setFrameOrigin(NSPoint(x: visible.midX - 250, y: visible.midY - 360)) }
            settings = window
        }
        NSApp.activate(ignoringOtherApps: true); settings?.makeKeyAndOrderFront(nil)
    }
    @objc func refresh() { Task { await model.refreshSources() } }
    @objc func quit() { NSApp.terminate(nil) }
}

@main struct DeskGlassMain {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate(); app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
