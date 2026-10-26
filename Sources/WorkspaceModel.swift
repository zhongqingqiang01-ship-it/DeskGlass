import AppKit
import SwiftUI
import EventKit

struct FileEntry: Identifiable {
    var url: URL
    var directory: Bool
    var id: String { url.path }
    var name: String { url.lastPathComponent }
}

@MainActor final class WorkspaceModel: ObservableObject {
    @Published var prefs: Preferences
    @Published var files: [FileEntry] = []
    @Published var selectedFolder: UUID?
    @Published var currentDirectory: URL?
    @Published var fileError: String?
    @Published var message: String?
    /// Short confirmation of a file operation (moved, trashed), cleared by the view after a moment.
    @Published var notice: String?
    @Published var reminderTasks: [RemoteTask] = []
    @Published var dingTasks: [RemoteTask] = []
    @Published var reminderState = "未连接"
    @Published var dingState = "未连接"
    @Published var reminderUpdated: Date?
    @Published var dingUpdated: Date?
    @Published var dingLoading = false
    @Published var now = Date()
    @Published var quoteOffset = 0
    private let disk: DiskStore
    private let eventStore = EKEventStore()
    private var writable = true
    private var timer: Timer?
    private var observer: NSObjectProtocol?
    var onSettings: (() -> Void)?
    var onAutoSize: (() -> Void)?
    var onPositionLockChange: ((Bool) -> Void)?
    /// Deletion only ever moves items to the Trash, where they can be restored (replaced in tests).
    var trashItem: (URL) throws -> Void = { try FileManager.default.trashItem(at: $0, resultingItemURL: nil) }
    @Published var positionsLocked = UserDefaults.standard.object(forKey: "DeskGlass.PositionsLocked") as? Bool ?? true {
        didSet {
            UserDefaults.standard.set(positionsLocked, forKey: "DeskGlass.PositionsLocked")
            onPositionLockChange?(positionsLocked)
        }
    }

    init(directory: URL? = nil) {
        disk = DiskStore(directory: directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("DeskGlass"))
        do { prefs = try disk.load() }
        catch { prefs = Preferences(); writable = false; message = "本地数据读取失败，已停止保存以保护原文件。请在设置中打开数据目录检查。" }
        selectedFolder = prefs.folders.first?.id
        if let first = prefs.folders.first { currentDirectory = URL(fileURLWithPath: first.path) }
        reloadFiles()
        timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                let next = Date()
                if DailyNote.dayKey(self.now) != DailyNote.dayKey(next) { self.quoteOffset = 0 }
                self.now = next; self.reloadFiles()
            }
        }
        observer = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: eventStore, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in await self?.refreshReminders() }
        }
        Task { await refreshSources() }
    }

    func save() {
        guard writable else { return }
        do { try disk.save(prefs) }
        catch { message = "保存失败：\(error.localizedDescription)。当前更改尚未保存。" }
    }
    func addTask(_ title: String, due: Date?) {
        let clean = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, clean.count <= 200 else { return }
        prefs.tasks.append(LocalTask(title: clean, due: due)); save()
    }
    func toggleTask(_ id: UUID) {
        guard let i = prefs.tasks.firstIndex(where: { $0.id == id }) else { return }
        prefs.tasks[i].completed.toggle(); save()
    }
    func deleteLocalTask(_ id: UUID) { prefs.tasks.removeAll { $0.id == id }; save() }
    var sortedTasks: [LocalTask] {
        prefs.tasks.sorted { a, b in
            if a.completed != b.completed { return !a.completed }
            if a.due != b.due { return (a.due ?? .distantFuture) < (b.due ?? .distantFuture) }
            return a.created > b.created
        }
    }
    var remoteTasks: [RemoteTask] {
        (reminderTasks + dingTasks).sorted { ($0.due ?? .distantFuture) < ($1.due ?? .distantFuture) }
    }
    func chooseFolder() {
        let picker = NSOpenPanel(); picker.canChooseDirectories = true; picker.canChooseFiles = false; picker.allowsMultipleSelection = true
        picker.prompt = "固定到工作台"; picker.message = "选择要直接查看文件的文件夹"
        guard picker.runModal() == .OK else { return }
        for url in picker.urls where !prefs.folders.contains(where: { $0.path == url.path }) { prefs.folders.append(FolderPin(path: url.path)) }
        if let url = picker.urls.first, let pin = prefs.folders.first(where: { $0.path == url.path }) { selectFolder(pin.id) }
        save()
    }
    func selectFolder(_ id: UUID) {
        selectedFolder = id
        currentDirectory = prefs.folders.first(where: { $0.id == id }).map { URL(fileURLWithPath: $0.path) }
        reloadFiles()
    }
    func removeFolder(_ id: UUID) {
        prefs.folders.removeAll { $0.id == id }
        if selectedFolder == id { selectedFolder = nil; currentDirectory = nil; if let first = prefs.folders.first { selectFolder(first.id) } }
        reloadFiles(); save()
    }
    func reloadFiles() {
        guard let url = currentDirectory else { files = []; fileError = nil; return }
        do {
            let entries = try FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]).map {
                FileEntry(url: $0, directory: (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false)
            }.sorted { a, b in
                if a.directory != b.directory { return a.directory }
                return a.name.localizedStandardCompare(b.name) == .orderedAscending
            }
            let byName = Dictionary(entries.map { ($0.name, $0) }, uniquingKeysWith: { first, _ in first })
            files = FileArrangement.arrange(entries.map(\.name), custom: prefs.fileOrder?[url.path]).compactMap { byName[$0] }
            fileError = nil
        } catch { files = []; fileError = "无法读取此文件夹，请检查位置或访问权限" }
    }
    /// Puts a dragged item in the place of the one it was dropped on, in the current folder; the arrangement is kept.
    func arrange(_ path: String, onto target: String) {
        guard let directory = currentDirectory, URL(fileURLWithPath: path).deletingLastPathComponent().path == directory.path else { return }
        let order = FileArrangement.moving(URL(fileURLWithPath: path).lastPathComponent, onto: URL(fileURLWithPath: target).lastPathComponent, in: files.map(\.name))
        var arrangement = prefs.fileOrder ?? [:]
        arrangement[directory.path] = order
        prefs.fileOrder = arrangement
        reloadFiles(); save()
    }
    func arrangePin(_ id: UUID, onto target: UUID) {
        guard id != target, let from = prefs.folders.firstIndex(where: { $0.id == id }), let to = prefs.folders.firstIndex(where: { $0.id == target }) else { return }
        prefs.folders.insert(prefs.folders.remove(at: from), at: to)
        save()
    }
    /// Renames on disk; returns why it could not, or nil once done.
    func rename(_ url: URL, to raw: String) -> String? {
        guard let name = FileArrangement.cleanName(raw) else { return "名称不能为空，不能包含「/」或「:」，也不能以「.」开头" }
        let target = url.deletingLastPathComponent().appendingPathComponent(name)
        guard name != url.lastPathComponent else { return nil }
        // A change of letter case only names the same item on a case-insensitive disk; that rename is allowed.
        let caseOnly = name.lowercased() == url.lastPathComponent.lowercased()
        guard caseOnly || !FileManager.default.fileExists(atPath: target.path) else { return "这里已有名为「\(name)」的项目" }
        do { try FileManager.default.moveItem(at: url, to: target) }
        catch { return "重命名失败：\(error.localizedDescription)" }
        relocate(url, to: target)
        reloadFiles(); save(); return nil
    }
    /// Creates an empty folder in the current folder ("未命名文件夹", numbered if taken) and returns it for renaming.
    func createFolder() -> URL? {
        guard let directory = currentDirectory else { return nil }
        var name = "未命名文件夹", number = 2
        while FileManager.default.fileExists(atPath: directory.appendingPathComponent(name).path) { name = "未命名文件夹 \(number)"; number += 1 }
        let url = directory.appendingPathComponent(name)
        do { try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false) }
        catch { message = "无法新建文件夹：\(error.localizedDescription)"; return nil }
        reloadFiles(); return url
    }
    @discardableResult func move(_ url: URL, into folder: URL) -> Bool {
        let target = folder.appendingPathComponent(url.lastPathComponent)
        guard folder.path != url.deletingLastPathComponent().path else { return false }
        guard folder.path != url.path, !folder.path.hasPrefix(url.path + "/") else { message = "不能把文件夹移到它自己里面"; return false }
        guard !FileManager.default.fileExists(atPath: target.path) else { message = "「\(folder.lastPathComponent)」里已有名为「\(url.lastPathComponent)」的项目"; return false }
        do { try FileManager.default.moveItem(at: url, to: target) }
        catch { message = "移动失败：\(error.localizedDescription)"; return false }
        relocate(url, to: target)
        notice = "已移到「\(folder.lastPathComponent)」：\(url.lastPathComponent)"
        reloadFiles(); save(); return true
    }
    func chooseDestination(for url: URL) {
        let picker = NSOpenPanel(); picker.canChooseDirectories = true; picker.canChooseFiles = false; picker.canCreateDirectories = true
        picker.directoryURL = url.deletingLastPathComponent(); picker.prompt = "移到这里"; picker.message = "选择「\(url.lastPathComponent)」要移到的文件夹"
        guard picker.runModal() == .OK, let folder = picker.url else { return }
        move(url, into: folder)
    }
    func trash(_ url: URL) {
        do { try trashItem(url) }
        catch { message = "无法移到废纸篓：\(error.localizedDescription)"; return }
        let inside = { (path: String) in path == url.path || path.hasPrefix(url.path + "/") }
        let unpinned = prefs.folders.filter { inside($0.path) }
        prefs.folders.removeAll { inside($0.path) }
        prefs.fileOrder = prefs.fileOrder?.filter { !inside($0.key) }
        if let current = currentDirectory, inside(current.path) {
            if let first = prefs.folders.first, unpinned.contains(where: { $0.id == selectedFolder }) { selectFolder(first.id) }
            else { currentDirectory = url.deletingLastPathComponent() }
        }
        if prefs.folders.isEmpty { selectedFolder = nil; currentDirectory = nil }
        notice = "已移到废纸篓：\(url.lastPathComponent)" + (unpinned.isEmpty ? "" : "，并移除了它的固定入口")
        reloadFiles(); save()
    }
    /// After a rename or move: pinned folders, the folder on view and saved arrangements follow the item to its new path.
    private func relocate(_ old: URL, to new: URL) {
        let moved = { (path: String) -> String? in
            path == old.path ? new.path : path.hasPrefix(old.path + "/") ? new.path + path.dropFirst(old.path.count) : nil
        }
        for i in prefs.folders.indices { if let path = moved(prefs.folders[i].path) { prefs.folders[i].path = path } }
        if let current = currentDirectory, let path = moved(current.path) { currentDirectory = URL(fileURLWithPath: path) }
        guard var arrangement = prefs.fileOrder else { return }
        for (key, order) in arrangement { if let path = moved(key) { arrangement[key] = nil; arrangement[path] = order } }
        let parent = old.deletingLastPathComponent().path
        if new.deletingLastPathComponent().path == parent, var order = arrangement[parent], let i = order.firstIndex(of: old.lastPathComponent) {
            order[i] = new.lastPathComponent; arrangement[parent] = order
        }
        prefs.fileOrder = arrangement
    }
    func open(_ entry: FileEntry) {
        if entry.directory { currentDirectory = entry.url; reloadFiles() }
        else if !NSWorkspace.shared.open(entry.url) { message = "无法打开该文件，请在 Finder 中检查" }
    }
    func openTool(_ tool: ToolLink) {
        guard let url = Self.toolURL(tool.target) else { message = "入口地址无效，请在设置中修改"; return }
        if !NSWorkspace.shared.open(url) { message = "无法打开入口，请检查应用或网址" }
    }
    static func toolURL(_ target: String) -> URL? {
        if target.hasPrefix("/") && target.hasSuffix(".app") { return URL(fileURLWithPath: target) }
        guard let url = URL(string: target), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else { return nil }
        return url
    }
    func addTool(name: String, target: String) -> Bool {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty, Self.toolURL(target) != nil else { return false }
        prefs.tools.append(ToolLink(name: name, target: target, symbol: "sparkles")); save(); return true
    }
    func selectApp() -> String? {
        let picker = NSOpenPanel(); picker.canChooseFiles = true; picker.canChooseDirectories = false; picker.directoryURL = URL(fileURLWithPath: "/Applications"); picker.prompt = "选择应用"
        guard picker.runModal() == .OK, let url = picker.url, url.pathExtension == "app" else { return nil }
        return url.path
    }
    func openDataDirectory() { NSWorkspace.shared.open(disk.directory) }
    func refreshSources() async {
        reloadFiles()
        await refreshReminders()
        if prefs.dingEnabled { await refreshDing() }
    }
    func connectReminders() async {
        do {
            let allowed = try await eventStore.requestFullAccessToReminders()
            prefs.remindersEnabled = allowed; save()
            if allowed { await refreshReminders() } else { reminderState = "未授权 · 请在系统设置中允许访问" }
        } catch { reminderState = "连接失败 · 请重试" }
    }
    func refreshReminders() async {
        guard prefs.remindersEnabled else { return }
        guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else { reminderState = "未授权 · 在设置中重新连接"; return }
        let predicate = eventStore.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
        let rows: [EKReminder]? = await withCheckedContinuation { continuation in eventStore.fetchReminders(matching: predicate) { continuation.resume(returning: $0) } }
        guard let rows else { reminderState = "读取失败 · 保留上次内容"; return }
        reminderTasks = rows.map { reminder in
            RemoteTask(id: "reminder-" + reminder.calendarItemIdentifier, title: reminder.title ?? "未命名待办", source: "提醒事项", due: reminder.dueDateComponents.flatMap { Calendar.current.date(from: $0) })
        }
        reminderUpdated = Date(); reminderState = "已连接 · \(rows.count) 项"
    }
    static var dwsPath: String? { ["/opt/homebrew/bin/dws", "/usr/local/bin/dws"].first { FileManager.default.isExecutableFile(atPath: $0) } }
    nonisolated static func runDWS(_ arguments: [String], timeout: Double = 45) async throws -> Data {
        try await Task.detached(priority: .utility) {
            guard let executable = ["/opt/homebrew/bin/dws", "/usr/local/bin/dws"].first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else { throw NSError(domain: "DWS", code: 1, userInfo: [NSLocalizedDescriptionKey: "未找到钉钉连接组件 dws"] ) }
            let process = Process(); process.executableURL = URL(fileURLWithPath: executable); process.arguments = arguments
            var env = ProcessInfo.processInfo.environment; env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"; process.environment = env
            let pipe = Pipe(); process.standardOutput = pipe; process.standardError = FileHandle.nullDevice; process.standardInput = FileHandle.nullDevice
            try process.run()
            let timer = DispatchSource.makeTimerSource(queue: .global()); timer.schedule(deadline: .now() + timeout)
            timer.setEventHandler { if process.isRunning { process.terminate() } }; timer.resume()
            let data = pipe.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit(); timer.cancel()
            guard process.terminationStatus == 0 else { throw NSError(domain: "DWS", code: 2, userInfo: [NSLocalizedDescriptionKey: "连接失败或超时，请检查网络及钉钉登录状态"] ) }
            return data
        }.value
    }
    func refreshDing() async {
        guard !dingLoading else { return }
        dingLoading = true; defer { dingLoading = false }
        dingState = "正在读取…"
        do {
            let statusData = try await Self.runDWS(["auth", "status", "--format", "json"])
            let auth = try JSONSerialization.jsonObject(with: statusData) as? [String: Any]
            guard auth?["authenticated"] as? Bool == true else { dingState = "未登录 · 请在设置中连接"; return }
            let data = try await Self.runDWS(["todo", "+get-my-tasks", "--all", "--status", "false", "--format", "json"])
            let rows = try DingParser.parse(data)
            dingTasks = rows; dingUpdated = Date(); dingState = "已连接 · \(rows.count) 项"
        } catch { dingState = "\(error.localizedDescription) · 保留上次内容" }
    }
    func connectDing() async {
        guard !dingLoading else { return }
        prefs.dingEnabled = true; save()
        await refreshDing()
        guard dingState.hasPrefix("未登录") else { return }
        dingLoading = true; dingState = "请在打开的浏览器中完成登录…"
        do {
            _ = try await Self.runDWS(["auth", "login", "--format", "json"], timeout: 180)
            dingLoading = false; await refreshDing()
        } catch { dingLoading = false; dingState = "登录未完成 · 点击连接重试" }
    }
    func openSource(_ source: String) {
        if source == "提醒事项" { NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/Reminders.app")) }
        else if let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.alibaba.DingTalkMac") { NSWorkspace.shared.open(app) }
        else if let url = URL(string: "https://www.dingtalk.com") { NSWorkspace.shared.open(url) }
    }
}
