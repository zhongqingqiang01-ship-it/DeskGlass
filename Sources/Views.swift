import SwiftUI
import AppKit
import UniformTypeIdentifiers

extension UTType { static let deskGlassEntry = UTType(exportedAs: "local.deskglass.entry") }

/// What is dragged inside the workbench: a file or folder (by path) or a pinned folder tab (by id). It has its own type,
/// so dropping it on another app or the desktop does nothing.
struct EntryDrag: Codable, Transferable {
    var path: String?
    var pin: UUID?
    static var transferRepresentation: some TransferRepresentation { CodableRepresentation(contentType: .deskGlassEntry) }
}

struct GlassMaterial: NSViewRepresentable {
    var density: Double
    private var materialOpacity: CGFloat {
        let normalized = min(max(density, 0), 0.65) / 0.65
        return CGFloat(0.30 + normalized * 0.70)
    }
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView(); view.material = .hudWindow; view.blendingMode = .behindWindow; view.state = .active
        view.appearance = NSAppearance(named: .darkAqua); view.alphaValue = materialOpacity; return view
    }
    func updateNSView(_ view: NSVisualEffectView, context: Context) { view.alphaValue = materialOpacity }
}

struct GlassCard<Content: View>: View {
    @ObservedObject var model: WorkspaceModel
    @ViewBuilder var content: Content
    var body: some View {
        content.padding(20).frame(maxWidth: .infinity, alignment: .leading)
            .background { ZStack { GlassMaterial(density: model.prefs.tint); Color.black.opacity(model.prefs.tint) } }
            .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).strokeBorder(.white.opacity(0.19), lineWidth: 0.7))
            .shadow(color: .black.opacity(0.16), radius: 15, y: 7)
    }
}

struct SidebarView: View {
    @ObservedObject var model: WorkspaceModel
    @State private var showAdd = false
    @State private var source = "全部"
    @State private var completed = false
    @State private var renaming: FileEntry?
    @State private var trashing: FileEntry?
    @State private var dropTarget: String?
    var body: some View {
        GeometryReader { geometry in
          ScrollView(.vertical) {
           VStack(spacing: 13) {
            HStack {
                Image(systemName: "command").font(.system(size: 12))
                Text("工作台").font(.system(size: 12, weight: .medium))
                Spacer()
                Button { model.positionsLocked.toggle() } label: { Image(systemName: model.positionsLocked ? "lock.fill" : "lock.open") }
                    .help(model.positionsLocked ? "位置已锁定，点击解锁后可拖动" : "允许拖动位置，点击锁定")
                Button { model.onAutoSize?() } label: { Image(systemName: "arrow.up.left.and.arrow.down.right") }.help("自动拉伸，适应主屏幕可用空间")
                Button { Task { await model.refreshSources() } } label: { Image(systemName: "arrow.clockwise") }.help("刷新文件和已连接的待办")
                Button { model.onSettings?() } label: { Image(systemName: "slider.horizontal.3") }.help("设置")
            }.foregroundStyle(.white.opacity(0.8)).padding(.horizontal, 15).padding(.top, 8)
            if let message = model.message {
                HStack(alignment: .top) { Text(message).font(.caption); Button { model.message = nil } label: { Image(systemName: "xmark") } }
                    .padding(12).background(.orange.opacity(0.25)).clipShape(RoundedRectangle(cornerRadius: 12))
            }
            folderCard(fileHeight: Self.wholeRows(max(110, (geometry.size.height - 650) * 0.62)))
            taskCard(listHeight: max(90, (geometry.size.height - 650) * 0.38))
            aiCard
            HStack(spacing: 6) {
                ResizeGrip().frame(width: 24, height: 22).help("拖动左下角，调整工作台大小")
                Text("拖动调整大小").font(.system(size: 10)).foregroundStyle(.white.opacity(0.4))
                Spacer()
            }.padding(.horizontal, 6)
           }.padding(15).frame(maxWidth: .infinity, minHeight: geometry.size.height, alignment: .top)
          }.scrollIndicators(.hidden)
        }.buttonStyle(.plain).foregroundStyle(.white).preferredColorScheme(.dark)
            .sheet(isPresented: $showAdd) { AddTaskView(model: model) }
    }
    // File tiles are 77pt tall with 15pt row spacing; snap the grid to whole rows so no icon row is cut in half.
    static func wholeRows(_ height: CGFloat) -> CGFloat {
        let rows = max(1, ((height - 2 + 15) / 92).rounded(.down))
        return rows * 77 + (rows - 1) * 15 + 2
    }
    private func folderCard(fileHeight: CGFloat) -> some View {
        GlassCard(model: model) {
            VStack(alignment: .leading, spacing: 13) {
                HStack { Label("文件夹", systemImage: "folder").font(.system(size: 14, weight: .semibold)); Spacer(); Button { model.chooseFolder() } label: { Image(systemName: "plus") }.help("固定文件夹") }
                if model.prefs.folders.isEmpty {
                    Button { model.chooseFolder() } label: { VStack(alignment: .leading, spacing: 9) { Text("把常用文件夹放在这里").font(.system(size: 13)); Text("点击选择，文件会直接显示在卡片里").font(.system(size: 11)).foregroundStyle(.secondary) }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 20) }
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 7) {
                            ForEach(model.prefs.folders) { pin in
                                Button { model.selectFolder(pin.id) } label: { Text(pin.name).font(.system(size: 11)).lineLimit(1).padding(.horizontal, 10).padding(.vertical, 6).background(.white.opacity(dropTarget == pin.id.uuidString ? 0.3 : pin.id == model.selectedFolder ? 0.17 : 0.04)).clipShape(Capsule()) }
                                    .help("拖动调整顺序；把文件拖到这里，移入「\(pin.name)」")
                                    .draggable(EntryDrag(pin: pin.id)) { Text(pin.name).font(.system(size: 11)).padding(.horizontal, 10).padding(.vertical, 6).background(.white.opacity(0.17), in: Capsule()) }
                                    .dropDestination(for: EntryDrag.self) { items, _ in
                                        guard let item = items.first else { return false }
                                        if let id = item.pin { model.arrangePin(id, onto: pin.id); return true }
                                        if let path = item.path { return model.move(URL(fileURLWithPath: path), into: URL(fileURLWithPath: pin.path)) }
                                        return false
                                    } isTargeted: { target(pin.id.uuidString, $0) }
                                    .contextMenu {
                                        Button("重命名…") { renaming = FileEntry(url: URL(fileURLWithPath: pin.path), directory: true) }
                                        Button("在 Finder 中显示") { NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: pin.path) }
                                        Divider()
                                        Button("从工作台移除") { model.removeFolder(pin.id) }
                                    }
                            }
                        }
                    }
                    if let current = model.currentDirectory {
                        HStack {
                            Button { model.currentDirectory = current.deletingLastPathComponent(); model.reloadFiles() } label: { Image(systemName: "chevron.left") }.help("上一级文件夹")
                            Text(current.lastPathComponent).lineLimit(1).font(.system(size: 11)).foregroundStyle(.secondary)
                            Spacer()
                            Button { if let url = model.createFolder() { renaming = FileEntry(url: url, directory: true) } } label: { Image(systemName: "folder.badge.plus") }.help("新建文件夹")
                            Button { NSWorkspace.shared.open(current) } label: { Image(systemName: "arrow.up.forward.square") }.help("在 Finder 中打开")
                        }
                    }
                    if let notice = model.notice {
                        Label(notice, systemImage: "checkmark.circle").font(.system(size: 10.5)).foregroundStyle(.white.opacity(0.65)).lineLimit(1)
                            .task(id: notice) { try? await Task.sleep(for: .seconds(3)); if model.notice == notice { model.notice = nil } }
                    }
                    if let error = model.fileError { Text(error).font(.caption).foregroundStyle(.orange) }
                    else if model.files.isEmpty { Text("这个文件夹里还没有文件").font(.caption).foregroundStyle(.secondary).padding(.vertical, 15) }
                    else {
                        ScrollView {
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 78), spacing: 10)], spacing: 15) {
                                ForEach(model.files) { file in fileTile(file) }
                            }.padding(.top, 2)
                        }.frame(height: fileHeight)
                    }
                }
            }
        }
        .sheet(item: $renaming) { entry in RenameView(model: model, entry: entry) }
        .alert("移到废纸篓？", isPresented: Binding(get: { trashing != nil }, set: { if !$0 { trashing = nil } }), presenting: trashing) { entry in
            Button("移到废纸篓", role: .destructive) { model.trash(entry.url) }
            Button("取消", role: .cancel) {}
        } message: { entry in Text("「\(entry.name)」会移到废纸篓，需要时可以从废纸篓放回原处。") }
    }
    // A tile opens on click; drag it onto another tile to take that place, or onto a folder tab to move it there.
    private func fileTile(_ file: FileEntry) -> some View {
        Button { model.open(file) } label: {
            VStack(spacing: 7) { Image(nsImage: NSWorkspace.shared.icon(forFile: file.url.path)).resizable().scaledToFit().frame(width: 36, height: 40); Text(file.name).font(.system(size: 11)).lineLimit(2).multilineTextAlignment(.center).frame(height: 30) }.frame(maxWidth: .infinity)
                .background(RoundedRectangle(cornerRadius: 10).fill(.white.opacity(dropTarget == file.id ? 0.14 : 0)))
        }.help(file.name)
        .draggable(EntryDrag(path: file.url.path)) { VStack(spacing: 5) { Image(nsImage: NSWorkspace.shared.icon(forFile: file.url.path)).resizable().scaledToFit().frame(width: 36, height: 40); Text(file.name).font(.system(size: 11)).lineLimit(1) } }
        .dropDestination(for: EntryDrag.self) { items, _ in
            guard let path = items.first?.path, path != file.url.path else { return false }
            model.arrange(path, onto: file.url.path); return true
        } isTargeted: { target(file.id, $0) }
        .contextMenu {
            Button("打开") { model.open(file) }
            Button("重命名…") { renaming = file }
            Menu("移动到") {
                ForEach(model.prefs.folders.filter { $0.path != model.currentDirectory?.path && $0.path != file.url.path }) { pin in
                    Button(pin.name) { model.move(file.url, into: URL(fileURLWithPath: pin.path)) }
                }
                Divider()
                Button("其他位置…") { model.chooseDestination(for: file.url) }
            }
            Button("在 Finder 中显示") { NSWorkspace.shared.activateFileViewerSelecting([file.url]) }
            Divider()
            Button("移到废纸篓…") { trashing = file }
        }
    }
    private func target(_ id: String, _ targeted: Bool) {
        if targeted { dropTarget = id } else if dropTarget == id { dropTarget = nil }
    }
    private func taskCard(listHeight: CGFloat) -> some View {
        GlassCard(model: model) {
            VStack(alignment: .leading, spacing: 13) {
                HStack { Label("待办", systemImage: "checkmark.circle").font(.system(size: 14, weight: .semibold)); Spacer(); Button { showAdd = true } label: { Image(systemName: "plus") }.help("添加本地待办") }
                Picker("来源", selection: $source) { ForEach(["全部", "工作台", "提醒事项", "钉钉"], id: \.self) { Text($0) } }.pickerStyle(.segmented).labelsHidden()
                ScrollView {
                    VStack(alignment: .leading, spacing: 15) {
                        if source == "全部" || source == "工作台" {
                            ForEach(model.sortedTasks.filter { !$0.completed || completed }) { task in
                                HStack(alignment: .top, spacing: 10) {
                                    Button { model.toggleTask(task.id) } label: { Image(systemName: task.completed ? "checkmark.circle.fill" : "circle").foregroundStyle(task.completed ? .mint : .white.opacity(0.5)).font(.system(size: 17)) }.help(task.completed ? "恢复待办" : "标记完成")
                                    VStack(alignment: .leading, spacing: 5) { Text(task.title).strikethrough(task.completed).opacity(task.completed ? 0.5 : 1).font(.system(size: 12)); Text(meta(source: "工作台", due: task.due)).font(.system(size: 10)).foregroundStyle(.secondary) }
                                    Spacer(minLength: 0)
                                }.contextMenu { Button("删除这条本地待办") { model.deleteLocalTask(task.id) } }
                            }
                        }
                        ForEach(model.remoteTasks.filter { source == "全部" || source == $0.source }) { task in
                            Button { model.openSource(task.source) } label: {
                                HStack(alignment: .top, spacing: 10) { Image(systemName: task.source == "钉钉" ? "paperplane" : "list.bullet").foregroundStyle(.white.opacity(0.5)); VStack(alignment: .leading, spacing: 5) { Text(task.title).font(.system(size: 12)); Text(meta(source: task.source, due: task.due)).font(.system(size: 10)).foregroundStyle(.secondary) }; Spacer(minLength: 0); Image(systemName: "arrow.up.right").font(.system(size: 10)).foregroundStyle(.secondary) }
                            }.help("在\(task.source)中处理；工作台只读展示")
                        }
                        if (source == "全部" || source == "工作台"), model.prefs.tasks.filter({ !$0.completed }).isEmpty { Text("今天，从一件小事开始。").font(.system(size: 12)).foregroundStyle(.secondary) }
                        if source == "全部" || source == "提醒事项" { connectionRow("提醒事项", state: model.reminderState, updated: model.reminderUpdated) }
                        if source == "全部" || source == "钉钉" { connectionRow("钉钉", state: model.dingState, updated: model.dingUpdated) }
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 3)
                }.frame(height: listHeight)
                HStack { Button { showAdd = true } label: { Label("记一件事", systemImage: "plus").font(.system(size: 11)) }; Spacer(); Button { completed.toggle() } label: { Text(completed ? "隐藏已完成" : "查看已完成").font(.system(size: 10)) }.foregroundStyle(.secondary) }
            }
        }
    }
    private func connectionRow(_ name: String, state: String, updated: Date?) -> some View {
        Button { model.onSettings?() } label: {
            VStack(alignment: .leading, spacing: 3) { Text("\(name) · \(state)").font(.system(size: 10)); if let updated { Text("更新于 \(updated.formatted(date: .omitted, time: .shortened))").font(.system(size: 10)) } }.foregroundStyle(.secondary)
        }
    }
    private func meta(source: String, due: Date?) -> String { source + (due.map { " · " + $0.formatted(date: .abbreviated, time: .omitted) } ?? "") }
    private var aiCard: some View {
        GlassCard(model: model) {
            VStack(alignment: .leading, spacing: 15) {
                HStack { Label("AI 工具", systemImage: "sparkles").font(.system(size: 13, weight: .medium)); Spacer(); Button { model.onSettings?() } label: { Image(systemName: "plus") }.help("管理工具入口") }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 68), spacing: 12)], spacing: 13) {
                    ForEach(model.prefs.tools) { tool in
                        Button { model.openTool(tool) } label: { VStack(spacing: 7) { ToolArtwork(tool: tool); Text(tool.name).font(.system(size: 10)).lineLimit(1) }.frame(maxWidth: .infinity) }.help(tool.target)
                    }
                }
            }
        }
    }
}

struct ToolArtwork: View {
    let tool: ToolLink
    var body: some View {
        Group {
            if let appURL = tool.nativeAppURL, FileManager.default.fileExists(atPath: appURL.path) {
                Image(nsImage: NSWorkspace.shared.icon(forFile: appURL.path))
                    .resizable().scaledToFit().frame(width: 42, height: 42)
            } else {
                Image(systemName: tool.symbol).font(.system(size: 21, weight: .light))
                    .frame(width: 42, height: 42).background(.white.opacity(0.09))
                    .clipShape(RoundedRectangle(cornerRadius: 13))
            }
        }.accessibilityHidden(true)
    }
}

struct ResizeGrip: NSViewRepresentable {
    func makeNSView(context: Context) -> GripView { GripView() }
    func updateNSView(_ view: GripView, context: Context) {}
    final class GripView: NSView {
        override var mouseDownCanMoveWindow: Bool { false }
        override func resetCursorRects() { addCursorRect(bounds, cursor: .crosshair) }
        override func draw(_ dirtyRect: NSRect) {
            NSColor.white.withAlphaComponent(0.5).setStroke()
            for offset in [CGFloat(0), 5, 10] {
                let line = NSBezierPath(); line.lineWidth = 1.3
                line.move(to: NSPoint(x: 4, y: 4 + offset)); line.line(to: NSPoint(x: 15 - offset, y: 15)); line.stroke()
            }
        }
        override func mouseDown(with event: NSEvent) {
            guard let window, let screen = window.screen else { return }
            let original = window.frame; let mouse = NSEvent.mouseLocation
            while let next = window.nextEvent(matching: [.leftMouseDragged, .leftMouseUp]) {
                if next.type == .leftMouseUp { break }
                let point = NSEvent.mouseLocation
                let delta = CGSize(width: point.x - mouse.x, height: point.y - mouse.y)
                window.setFrame(WorkbenchSizing.resized(original, delta: delta, in: screen.visibleFrame), display: true)
            }
            window.saveFrame(usingName: "DeskGlass.Sidebar")
        }
    }
}

struct QuoteView: View {
    @ObservedObject var model: WorkspaceModel
    var body: some View {
        VStack(alignment: .leading, spacing: 21) {
            Text("给今天的你").font(.system(size: 11)).tracking(3).foregroundStyle(.white.opacity(0.65))
            Text(DailyNote.quote(model.now, offset: model.quoteOffset)).font(.system(size: 30, weight: .light)).lineSpacing(11).fixedSize(horizontal: false, vertical: true).id(DailyNote.quote(model.now, offset: model.quoteOffset)).transition(.opacity.combined(with: .offset(y: 6)))
            HStack(spacing: 18) {
                Text(model.now.formatted(.dateTime.month(.wide).day().weekday(.wide))).font(.system(size: 11)).foregroundStyle(.white.opacity(0.6))
                Button { withAnimation(.easeOut(duration: 0.35)) { model.quoteOffset += 1 } } label: { Label("换一句", systemImage: "arrow.clockwise").font(.system(size: 11)).padding(.horizontal, 10).padding(.vertical, 7).background(.white.opacity(0.06)).clipShape(Capsule()) }.buttonStyle(.plain)
            }
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading).padding(22).foregroundStyle(.white.opacity(0.94)).shadow(color: .black.opacity(0.45), radius: 6, y: 2).preferredColorScheme(.dark)
    }
}

struct RenameView: View {
    @ObservedObject var model: WorkspaceModel
    let entry: FileEntry
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var problem: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(entry.directory ? "重命名文件夹" : "重命名文件").font(.title3)
            TextField("名称", text: $name).textFieldStyle(.roundedBorder).onSubmit(apply)
            if let problem { Text(problem).font(.caption).foregroundStyle(.orange) }
            HStack { Spacer(); Button("取消") { dismiss() }.keyboardShortcut(.cancelAction); Button("重命名", action: apply).keyboardShortcut(.defaultAction).disabled(FileArrangement.cleanName(name) == nil) }
        }.padding(25).frame(width: 370).onAppear { name = entry.name }
    }
    private func apply() {
        problem = model.rename(entry.url, to: name)
        if problem == nil { dismiss() }
    }
}

struct AddTaskView: View {
    @ObservedObject var model: WorkspaceModel
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var hasDate = false
    @State private var due = Date()
    var body: some View {
        VStack(alignment: .leading, spacing: 18) { Text("记一件事").font(.title3); TextField("待办内容", text: $title).textFieldStyle(.roundedBorder).onSubmit(add); Toggle("设置截止日期", isOn: $hasDate); if hasDate { DatePicker("截止", selection: $due, displayedComponents: [.date]) }; HStack { Spacer(); Button("取消") { dismiss() }.keyboardShortcut(.cancelAction); Button("添加", action: add).keyboardShortcut(.defaultAction).disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || title.count > 200) } }.padding(25).frame(width: 370)
    }
    private func add() { guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, title.count <= 200 else { return }; model.addTask(title, due: hasDate ? due : nil); dismiss() }
}

struct SettingsView: View {
    @ObservedObject var model: WorkspaceModel
    @State private var toolName = ""
    @State private var toolTarget = ""
    @State private var toolError = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text("工作台设置").font(.title2)
                GroupBox("外观") { VStack(alignment: .leading, spacing: 10) { Text("烟玻璃浓度").font(.callout); Slider(value: $model.prefs.tint, in: 0.0...0.65, step: 0.005, onEditingChanged: { editing in if !editing { model.save() } }); Toggle("锁定工作台和寄语位置", isOn: $model.positionsLocked); Text("浓度向左更通透、向右更深；最低档仍保留轻微磨砂。默认锁定位置，锁定时仍可拉伸大小。").font(.caption).foregroundStyle(.secondary) }.padding(10) }
                GroupBox("待办来源") {
                    VStack(alignment: .leading, spacing: 13) {
                        HStack { VStack(alignment: .leading) { Text("Mac 提醒事项"); Text(model.reminderState).font(.caption).foregroundStyle(.secondary) }; Spacer(); Button("连接") { Task { await model.connectReminders() } } }
                        Divider()
                        HStack { VStack(alignment: .leading) { Text("钉钉"); Text(model.dingState).font(.caption).foregroundStyle(.secondary) }; Spacer(); Button(model.dingLoading ? "连接中…" : "连接") { Task { await model.connectDing() } }.disabled(model.dingLoading) }
                        Text("外部待办只读汇总，点击条目在来源应用中处理。使用顶部刷新按钮读取最新状态。").font(.caption).foregroundStyle(.secondary)
                    }.padding(10)
                }
                GroupBox("AI 工具入口") {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(model.prefs.tools) { tool in
                            HStack { VStack(alignment: .leading, spacing: 4) { Text(tool.name); Text(tool.target).font(.caption).foregroundStyle(.secondary).lineLimit(1) }; Spacer(); Button("移除") { model.prefs.tools.removeAll { $0.id == tool.id }; model.save() } }
                        }
                        Divider()
                        TextField("工具名称", text: $toolName).textFieldStyle(.roundedBorder)
                        TextField("网址或应用路径", text: $toolTarget).textFieldStyle(.roundedBorder)
                        HStack { Button("选择 Mac 应用") { if let app = model.selectApp() { toolTarget = app; if toolName.isEmpty { toolName = URL(fileURLWithPath: app).deletingPathExtension().lastPathComponent } } }; Spacer(); Button("添加入口") { if model.addTool(name: toolName, target: toolTarget) { toolName = ""; toolTarget = ""; toolError = false } else { toolError = true } } }
                        if toolError { Text("请填写名称和完整网址，或选择一个 Mac 应用。").font(.caption).foregroundStyle(.orange) }
                    }.padding(10)
                }
                HStack { Text("DeskGlass 0.1.0 · 数据保存在本机").font(.caption).foregroundStyle(.secondary); Spacer(); Button("打开数据目录") { model.openDataDirectory() } }
            }.padding(25)
        }.frame(minWidth: 470, minHeight: 650).preferredColorScheme(.dark)
    }
}
