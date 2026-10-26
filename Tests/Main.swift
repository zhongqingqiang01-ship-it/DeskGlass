import Foundation

@main struct CoreTests {
    @MainActor static func main() throws {
        var checks = 0
        func check(_ value: @autoclosure () -> Bool, _ label: String) { precondition(value(), label); checks += 1 }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("DeskGlass-tests-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = DiskStore(directory: root.appendingPathComponent("data"))
        let mainScreen = CGRect(x: 0, y: 66, width: 1920, height: 984)
        let fitted = WorkbenchSizing.fitted(in: mainScreen)
        check(mainScreen.contains(fitted) && fitted.width > 600 && fitted.height == 948, "auto stretch uses available primary screen without covering Dock")
        let expanded = WorkbenchSizing.resized(fitted, delta: CGSize(width: -180, height: -300), in: mainScreen)
        check(mainScreen.contains(expanded) && expanded.width > fitted.width && expanded.maxX == fitted.maxX, "resize expands left while keeping right edge inside main screen")
        let tiny = WorkbenchSizing.resized(fitted, delta: CGSize(width: 2000, height: 2000), in: mainScreen)
        check(tiny.width == 380 && tiny.height == 740, "resize keeps usable minimum size")
        let secondary = CGRect(x: -1470, y: -78, width: 1470, height: 924)
        check(secondary.contains(WorkbenchSizing.fitted(in: secondary)), "auto stretch supports screens with negative coordinates")
        let appTool = ToolLink(name: "本机应用", target: "/Applications/我的 AI.app", symbol: "sparkles")
        check(appTool.nativeAppURL?.path == "/Applications/我的 AI.app", "native app paths preserve Chinese names and spaces for original artwork")
        check(ToolLink(name: "网页", target: "https://example.app", symbol: "star").nativeAppURL == nil, "web links never treated as app bundles")
        check(ToolLink(name: "普通文件", target: "/tmp/example.png", symbol: "star").nativeAppURL == nil, "non-app files do not use app artwork")
        let initial = try store.load()
        check(initial.tasks.isEmpty, "fresh install has no fake tasks")
        var prefs = initial
        prefs.tasks = [LocalTask(title: "保留中文、空格和 $() 字符", due: Date(timeIntervalSince1970: 1_000_000))]
        prefs.folders = [FolderPin(path: root.path)]
        try store.save(prefs)
        let restored = try store.load()
        check(restored.tasks == prefs.tasks && restored.folders == prefs.folders, "data survives restart")
        let model = WorkspaceModel(directory: store.directory)
        model.addTask("   ", due: nil)
        check(model.prefs.tasks.count == 1, "blank task rejected")
        model.addTask("第二件事", due: nil)
        model.toggleTask(prefs.tasks[0].id)
        check(model.sortedTasks.first?.title == "第二件事", "completed tasks sort below unfinished tasks")
        let toggled = try store.load()
        check(toggled.tasks.first?.completed == true && toggled.tasks.count == 2, "task completion persists")
        model.toggleTask(prefs.tasks[0].id)
        check(model.sortedTasks.first?.id == prefs.tasks[0].id, "due date sorts ahead of undated task")
        try FileManager.default.createDirectory(at: root.appendingPathComponent("Folder"), withIntermediateDirectories: true)
        try Data("test".utf8).write(to: root.appendingPathComponent("文件.txt"))
        try Data("test".utf8).write(to: root.appendingPathComponent(".hidden"))
        model.currentDirectory = root; model.reloadFiles()
        check(model.files.first?.directory == true, "folders sort before files")
        check(!model.files.contains { $0.url.lastPathComponent == ".hidden" }, "hidden files stay hidden")
        check(model.files.contains { $0.url.lastPathComponent == "文件.txt" }, "actual folder contents loaded")
        model.removeFolder(prefs.folders[0].id)
        check(FileManager.default.fileExists(atPath: root.appendingPathComponent("文件.txt").path), "removing pin preserves disk files")
        check(WorkspaceModel.toolURL("https://chatgpt.com") != nil, "web tools accepted")
        check(WorkspaceModel.toolURL("/Applications/Test.app")?.isFileURL == true, "native app tools accepted")
        check(WorkspaceModel.toolURL("javascript:alert(1)") == nil, "script scheme rejected")
        check(WorkspaceModel.toolURL("file:///etc/passwd") == nil, "arbitrary file schemes rejected")
        let iso = ISO8601DateFormatter()
        let before = iso.date(from: "2026-10-23T15:59:59Z")!
        let after = iso.date(from: "2026-10-23T16:00:00Z")!
        check(DailyNote.dayKey(before) == "2026-10-23" && DailyNote.dayKey(after) == "2026-10-24", "daily rotation uses Shanghai midnight")
        check(DailyNote.quote(before) != DailyNote.quote(after), "quote changes across midnight")
        check(DailyNote.quote(before) != DailyNote.quote(before, offset: 1), "manual quote rotation works")
        let fixture: [String: Any] = ["success": true, "data": ["complete": true, "todos": [["taskId": "stable-1", "subject": "真实格式示例", "dueTime": 1_800_000_000_000], ["taskId": "stable-1", "subject": "重复行"]]]]
        let parsed = try DingParser.parse(JSONSerialization.data(withJSONObject: fixture))
        check(parsed.count == 1 && parsed[0].due != nil, "DingTalk stable IDs deduplicated and deadlines parsed")
        do { _ = try DingParser.parse(Data("{\"success\":true,\"data\":{\"complete\":false,\"todos\":[]}}".utf8)); preconditionFailure("partial result accepted") } catch { checks += 1 }
        do { _ = try DingParser.parse(Data("{\"success\":false,\"message\":\"not logged in\"}".utf8)); preconditionFailure("auth failure accepted") } catch { checks += 1 }
        check(FileArrangement.moving("A", onto: "C", in: ["A", "B", "C", "D"]) == ["B", "C", "A", "D"], "dragging forward takes the target's place")
        check(FileArrangement.moving("D", onto: "B", in: ["A", "B", "C", "D"]) == ["A", "D", "B", "C"], "dragging back takes the target's place")
        check(FileArrangement.arrange(["新", "甲", "乙"], custom: ["乙", "已删除", "甲"]) == ["乙", "甲", "新"], "own arrangement first, gone names skipped, new items after")
        check(FileArrangement.cleanName("  报告 2026.pdf ") == "报告 2026.pdf", "names trimmed, Chinese and spaces kept")
        check(["", "   ", "a/b", "a:b", ".隐藏"].allSatisfy { FileArrangement.cleanName($0) == nil }, "empty, separator and hidden names rejected")
        let desk = root.appendingPathComponent("桌面"), work = desk.appendingPathComponent("工作"), other = desk.appendingPathComponent("其他")
        for folder in [work, other] { try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true) }
        for name in ["a.txt", "b.txt", "c.txt"] { try Data(name.utf8).write(to: work.appendingPathComponent(name)) }
        let editor = WorkspaceModel(directory: root.appendingPathComponent("edit-data"))
        var trashed: [URL] = []
        editor.trashItem = { trashed.append($0); try FileManager.default.removeItem(at: $0) }
        editor.prefs.folders = [FolderPin(path: work.path), FolderPin(path: other.path)]
        editor.selectFolder(editor.prefs.folders[0].id)
        let names = { editor.files.map(\.name) }
        editor.arrange(work.appendingPathComponent("c.txt").path, onto: work.appendingPathComponent("a.txt").path)
        check(names() == ["c.txt", "a.txt", "b.txt"], "dragging a tile reorders the folder view")
        check(WorkspaceModel(directory: root.appendingPathComponent("edit-data")).prefs.fileOrder?[work.path] == ["c.txt", "a.txt", "b.txt"], "arrangement survives restart")
        check(editor.rename(work.appendingPathComponent("a.txt"), to: "b.txt") != nil && FileManager.default.fileExists(atPath: work.appendingPathComponent("a.txt").path), "rename onto an existing name refused, original kept")
        check(editor.rename(work.appendingPathComponent("a.txt"), to: "方案.txt") == nil && names() == ["c.txt", "方案.txt", "b.txt"], "rename on disk keeps the item's place")
        check(editor.rename(work.appendingPathComponent("b.txt"), to: "B.txt") == nil && names().contains("B.txt"), "letter-case rename allowed")
        let created = editor.createFolder(), second = editor.createFolder()
        check(created?.lastPathComponent == "未命名文件夹" && second?.lastPathComponent == "未命名文件夹 2", "new folders get free names")
        check(editor.move(work.appendingPathComponent("c.txt"), into: other) && FileManager.default.fileExists(atPath: other.appendingPathComponent("c.txt").path) && !names().contains("c.txt"), "move into a pinned folder")
        try Data("dup".utf8).write(to: work.appendingPathComponent("c.txt"))
        check(!editor.move(work.appendingPathComponent("c.txt"), into: other) && (try? String(contentsOf: other.appendingPathComponent("c.txt"), encoding: .utf8)) == "c.txt", "move never overwrites a same-named item")
        check(!editor.move(work, into: work.appendingPathComponent("未命名文件夹")), "folder cannot move into itself")
        check(editor.rename(work, to: "工作2026") == nil && editor.prefs.folders[0].path == desk.appendingPathComponent("工作2026").path && editor.currentDirectory?.lastPathComponent == "工作2026", "renaming a pinned folder keeps its tab and view")
        editor.arrangePin(editor.prefs.folders[1].id, onto: editor.prefs.folders[0].id)
        check(editor.prefs.folders.map(\.name) == ["其他", "工作2026"], "folder tabs reorder by drag")
        editor.currentDirectory = desk; editor.reloadFiles()
        editor.trash(other)
        check(trashed == [other] && editor.prefs.folders.map(\.name) == ["工作2026"], "trashing a pinned folder goes through the Trash and drops its tab")
        let corrupt = Data("damaged-data".utf8)
        try corrupt.write(to: store.file)
        let protected = WorkspaceModel(directory: store.directory)
        protected.addTask("不得覆盖损坏数据", due: nil)
        let preserved = try Data(contentsOf: store.file)
        check(preserved == corrupt, "failed load cannot overwrite existing data")
        print("PASS: \(checks) behavior checks; isolated fixtures removed.")
    }
}
