import Foundation

enum WorkbenchSizing {
    static func fitted(in screen: CGRect) -> CGRect {
        let width = min(max(580, screen.width * 0.35), 800, screen.width - 36)
        let height = max(1, screen.height - 36)
        return CGRect(x: screen.maxX - width - 18, y: screen.minY + 18, width: width, height: height)
    }
    static func resized(_ start: CGRect, delta: CGSize, in screen: CGRect) -> CGRect {
        let minWidth = min(380, screen.width - 36)
        let minHeight = min(740, screen.height - 36)
        let right = min(start.maxX, screen.maxX - 12)
        let top = min(start.maxY, screen.maxY - 12)
        let width = min(max(minWidth, start.width - delta.width), right - screen.minX - 12)
        let height = min(max(minHeight, start.height - delta.height), top - screen.minY - 12)
        return CGRect(x: right - width, y: top - height, width: width, height: height)
    }
}

struct LocalTask: Codable, Identifiable, Equatable {
    var id = UUID()
    var title: String
    var completed = false
    var created = Date()
    var due: Date?
}

struct FolderPin: Codable, Identifiable, Equatable {
    var id = UUID()
    var path: String
    var name: String { URL(fileURLWithPath: path).lastPathComponent }
}

struct ToolLink: Codable, Identifiable, Equatable {
    var id = UUID()
    var name: String
    var target: String
    var symbol: String
    var nativeAppURL: URL? {
        guard target.hasPrefix("/") else { return nil }
        let url = URL(fileURLWithPath: target)
        return url.pathExtension.lowercased() == "app" ? url : nil
    }
    static let defaults = [
        ToolLink(name: "ChatGPT", target: "https://chatgpt.com", symbol: "sparkles"),
        ToolLink(name: "Claude", target: "https://claude.ai", symbol: "sun.max"),
        ToolLink(name: "Gemini", target: "https://gemini.google.com", symbol: "star"),
    ]
}

struct Preferences: Codable {
    var folders: [FolderPin] = []
    var tasks: [LocalTask] = []
    var tools = ToolLink.defaults
    var tint = 0.24
    var remindersEnabled = false
    var dingEnabled = false
    /// The user's own arrangement of items per folder path, by name (optional so older data files still load).
    var fileOrder: [String: [String]]?
}

enum FileArrangement {
    /// Names listed in `custom` first, in that order; the rest after them in their given (default) order.
    static func arrange(_ names: [String], custom: [String]?) -> [String] {
        guard let custom else { return names }
        let present = Set(names), placed = Set(custom)
        return custom.filter { present.contains($0) } + names.filter { !placed.contains($0) }
    }
    /// The order after dragging `name` onto `target`: it takes the target's place, and the items in between shift by one.
    static func moving(_ name: String, onto target: String, in names: [String]) -> [String] {
        guard name != target, let from = names.firstIndex(of: name), let to = names.firstIndex(of: target) else { return names }
        var result = names
        result.remove(at: from)
        result.insert(name, at: to)
        return result
    }
    /// A usable file or folder name, or nil: not empty, no path separators, not hidden (a leading dot would make the
    /// item disappear from the workbench and Finder), and within the file system's 255-byte limit.
    static func cleanName(_ raw: String) -> String? {
        let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, !name.hasPrefix("."), !name.contains("/"), !name.contains(":"), name.utf8.count <= 255 else { return nil }
        return name
    }
}

struct DiskStore {
    let directory: URL
    var file: URL { directory.appendingPathComponent("workspace.json") }
    func load() throws -> Preferences {
        guard FileManager.default.fileExists(atPath: file.path) else { return Preferences() }
        return try JSONDecoder().decode(Preferences.self, from: Data(contentsOf: file))
    }
    func save(_ value: Preferences) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let data = try JSONEncoder().encode(value)
        try data.write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
}

struct RemoteTask: Identifiable, Equatable {
    var id: String
    var title: String
    var source: String
    var due: Date?
}

enum DingParser {
    static func parse(_ data: Data) throws -> [RemoteTask] {
        guard let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any], envelope["success"] as? Bool == true,
              let body = (envelope["result"] ?? envelope["data"]) as? [String: Any],
              body["complete"] as? Bool == true, let rows = body["todos"] as? [[String: Any]] else {
            throw NSError(domain: "DingTalk", code: 1, userInfo: [NSLocalizedDescriptionKey: "返回的列表不完整"])
        }
        var seen = Set<String>()
        return try rows.compactMap { row in
            guard let id = (row["taskId"] ?? row["id"] ?? row["todoTaskId"]) as? String, !id.isEmpty,
                  let title = (row["subject"] ?? row["title"]) as? String, !title.isEmpty else {
                throw NSError(domain: "DingTalk", code: 2, userInfo: [NSLocalizedDescriptionKey: "钉钉数据格式有变化，请更新接入"])
            }
            guard seen.insert(id).inserted else { return nil }
            let dueValue = row["dueTime"] ?? row["planFinishDate"] ?? row["due"]
            let millis = (dueValue as? NSNumber)?.doubleValue ?? (dueValue as? String).flatMap(Double.init)
            return RemoteTask(id: "ding-" + id, title: title, source: "钉钉", due: millis.flatMap { $0 > 0 ? Date(timeIntervalSince1970: $0 / 1000) : nil })
        }
    }
}

enum DailyNote {
    static let quotes = [
        "慢一点也没关系，\n你一直在向前。", "把今天的一小步，\n走踏实。", "给自己一点时间，\n好的变化正在发生。",
        "今天的认真，\n会成为明天的底气。", "先照顾好自己，\n再去拥抱更大的世界。", "平凡的一天，\n也值得好好度过。",
        "那些慢慢积累的努力，\n会在某天给你答案。", "允许自己休息，\n也相信自己能继续。", "从一件小事开始，\n让今天有一点不同。",
        "愿你忙有所值，\n闲有所趣。", "眼前的每一步，\n都在把远方拉近。", "今天也记得，\n给自己一点掌声。"
    ]
    static func dayKey(_ date: Date) -> String {
        let formatter = DateFormatter(); formatter.timeZone = TimeZone(identifier: "Asia/Shanghai"); formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
    static func quote(_ date: Date, offset: Int = 0) -> String {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        let start = calendar.startOfDay(for: date)
        let epoch = calendar.startOfDay(for: Date(timeIntervalSince1970: 0))
        let ordinal = calendar.dateComponents([.day], from: epoch, to: start).day ?? 0
        return quotes[((ordinal + offset) % quotes.count + quotes.count) % quotes.count]
    }
}
