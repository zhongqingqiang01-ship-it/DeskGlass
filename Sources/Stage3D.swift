import AppKit
import SwiftUI
import WebKit

@MainActor final class DeskStageModel: ObservableObject {
    var objects: [(String, String)] {
        var values = [("ferrari", "Ferrari 458 Italia")]
        if FileManager.default.fileExists(atPath: assets.appendingPathComponent("models/gundam.js").path) {
            values.append(("gundam", "自由高达 · 本地模型"))
        }
        values.append(("pet", "电子小狗"))
        return values
    }
    @Published var selected: String = UserDefaults.standard.string(forKey: "DeskGlass.Stage.Model") ?? "ferrari" {
        didSet { if !validates { UserDefaults.standard.set(selected, forKey: "DeskGlass.Stage.Model") } }
    }
    static let paints = [("#b3111f", "Rosso Corsa · 赛道红"), ("#f2b705", "Giallo Modena · 摩德纳黄"), ("#e8e8e3", "Bianco Avus · 珍珠白"),
                         ("#1b3a8c", "Blu Tour de France · 法兰西蓝"), ("#1f3d2f", "Verde British · 英伦绿"), ("#121418", "Nero Daytona · 代托纳黑")]
    private static let legacyPaints = ["#b80e24": "#b3111f", "#e4bb22": "#f2b705", "#e3e6eb": "#e8e8e3", "#194da7": "#1b3a8c", "#202630": "#121418"]
    @Published var color = UserDefaults.standard.string(forKey: "DeskGlass.Stage.Color") ?? "#b3111f" {
        didSet { if !validates { UserDefaults.standard.set(color, forKey: "DeskGlass.Stage.Color") } }
    }
    @Published var autoRotate = false
    @Published var renderVisible = true
    @Published var status = "正在准备桌面展品…"
    /// Mood / energy / activity reported by the pet; persisted so it remembers how it was doing between launches.
    @Published var pet: [String: Any] = (UserDefaults.standard.dictionary(forKey: "DeskGlass.Stage.Pet") ?? [:]) {
        didSet { if !validates { UserDefaults.standard.set(pet, forKey: "DeskGlass.Stage.Pet") } }
    }
    @Published var shown = UserDefaults.standard.object(forKey: "DeskGlass.Stage.Shown") as? Bool ?? true {
        didSet { UserDefaults.standard.set(shown, forKey: "DeskGlass.Stage.Shown"); onVisibility?(shown) }
    }
    var onVisibility: ((Bool) -> Void)?
    var onCommand: ((String) -> Void)?
    var onValidation: ((Result<[String: Any], Error>) -> Void)?
    let assets: URL
    let validates: Bool
    init(assets: URL? = nil, validates: Bool = false) {
        self.assets = assets ?? Bundle.main.resourceURL!.appendingPathComponent("Stage")
        self.validates = validates
        if !objects.contains(where: { $0.0 == selected }) { selected = "ferrari" }
        if !Self.paints.contains(where: { $0.0 == color }) { color = Self.legacyPaints[color] ?? Self.paints[0].0 }
    }
    var title: String { objects.first { $0.0 == selected }?.1 ?? "" }
    var subtitle: String {
        switch selected {
        case "ferrari": return Self.paints.first { $0.0 == color }?.1 ?? ""
        case "pet":
            guard let mood = pet["mood"] as? Int, let energy = pet["energy"] as? Int else { return "点它打招呼 · 按住拖动抚摸 · 点地面扔球" }
            return "心情 \(mood) · 电量 \(energy)% · \((pet["activity"] as? String) ?? "")"
        default: return "双击切换动作：展翼 · 射击 · 全速推进"
        }
    }
    func step(_ offset: Int) {
        let index = objects.firstIndex { $0.0 == selected } ?? 0
        selected = objects[(index + offset + objects.count) % objects.count].0
    }
    var configuration: String {
        var value: [String: Any] = ["model": selected, "color": color, "autoRotate": autoRotate]
        if let mood = pet["mood"], let energy = pet["energy"], let saved = pet["saved"] { value["pet"] = ["mood": mood, "energy": energy, "saved": saved] }
        return String(data: try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), encoding: .utf8)!
    }
}

struct DesktopStageWebView: NSViewRepresentable {
    @ObservedObject var model: DeskStageModel
    func makeCoordinator() -> Coordinator { Coordinator(model: model) }
    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(context.coordinator, name: "stage")
        let web = WKWebView(frame: .zero, configuration: config)
        web.underPageBackgroundColor = .clear
        web.setValue(false, forKey: "drawsBackground")
        web.navigationDelegate = context.coordinator
        web.setAccessibilityLabel("三维桌面展品：拖动旋转，滚轮缩放，双击互动")
        context.coordinator.web = web
        model.onCommand = { [weak coordinator = context.coordinator] command in coordinator?.command(command) }
        web.loadFileURL(model.assets.appendingPathComponent("index.html"), allowingReadAccessTo: model.assets)
        return web
    }
    func updateNSView(_ web: WKWebView, context: Context) { context.coordinator.configure() }
    static func dismantleNSView(_ web: WKWebView, coordinator: Coordinator) {
        web.configuration.userContentController.removeScriptMessageHandler(forName: "stage")
        web.stopLoading(); coordinator.web = nil
    }
    @MainActor final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        let model: DeskStageModel
        weak var web: WKWebView?
        var booted = false
        var lastConfiguration = ""
        var validationStarted = false
        var lastVisibility: Bool?
        init(model: DeskStageModel) { self.model = model }
        func configure(force: Bool = false) {
            guard booted, !model.validates, let web else { return }
            if lastVisibility != model.renderVisible {
                lastVisibility = model.renderVisible
                web.evaluateJavaScript("window.deskStage?.setVisible(\(model.renderVisible ? "true" : "false"))", completionHandler: nil)
            }
            let config = model.configuration
            guard force || config != lastConfiguration else { return }
            lastConfiguration = config
            web.evaluateJavaScript("window.deskStage?.configure(\(config))", completionHandler: nil)
        }
        func command(_ name: String) {
            if ["home", "action"].contains(name) { web?.evaluateJavaScript("window.deskStage?.\(name)()", completionHandler: nil) }
            else if ["ball", "feed", "trick", "sleep"].contains(name) { web?.evaluateJavaScript("window.deskStage?.command('\(name)')", completionHandler: nil) }
        }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let value = message.body as? [String: Any] else { return }
            if value["booted"] as? Bool == true {
                booted = true
                if model.validates && !validationStarted {
                    validationStarted = true
                    web?.callAsyncJavaScript("return await window.deskStage.selfTest()", arguments: [:], in: nil, in: .page) { [weak self] result in
                        guard let self else { return }
                        switch result {
                        case .success(let value):
                            if let object = value as? [String: Any] { self.model.onValidation?(.success(object)) }
                        case .failure(let error): self.model.onValidation?(.failure(error))
                        }
                    }
                } else { configure(force: true) }
            }
            if let status = value["message"] as? String { model.status = status }
            if let pet = value["pet"] as? [String: Any], !model.validates { model.pet = pet }
            if let error = value["error"] as? String, model.validates {
                model.onValidation?(.failure(NSError(domain: "DeskGlassStage", code: 1, userInfo: [NSLocalizedDescriptionKey: error])))
            }
        }
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url, url.isFileURL,
                  url.standardizedFileURL.path.hasPrefix(model.assets.standardizedFileURL.path + "/") else { decisionHandler(.cancel); return }
            decisionHandler(.allow)
        }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { model.status = "展示区加载失败，请重新打开工作台" }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { model.status = "本地展示资源不可用，请重新构建工作台" }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            booted = false; lastConfiguration = ""; model.status = "正在恢复展示区…"; webView.reload()
        }
    }
}

struct DesktopStageView: View {
    @ObservedObject var model: DeskStageModel
    @State private var credits = false
    var body: some View {
        ZStack(alignment: .bottom) {
            DesktopStageWebView(model: model)
            VStack(spacing: 12) {
                VStack(spacing: 4) {
                    HStack(spacing: 16) {
                        StageButton(symbol: "chevron.left", help: "上一个展品") { model.step(-1) }
                        Text(model.title).font(.system(size: 15, weight: .semibold)).tracking(0.4)
                            .contentTransition(.opacity).frame(minWidth: 150)
                            .contextMenu { ForEach(model.objects, id: \.0) { entry in Button(entry.1) { model.selected = entry.0 } } }
                        StageButton(symbol: "chevron.right", help: "下一个展品") { model.step(1) }
                    }
                    Text(model.subtitle).font(.system(size: 10.5)).tracking(0.6).foregroundStyle(.white.opacity(0.55))
                }.shadow(color: .black.opacity(0.35), radius: 6, y: 1)
                HStack(spacing: 4) {
                    if model.selected == "ferrari" {
                        HStack(spacing: 2) {
                            ForEach(DeskStageModel.paints, id: \.0) { paint in
                                PaintSwatch(color: color(paint.0), selected: model.color == paint.0) { model.color = paint.0 }.help(paint.1)
                            }
                        }
                        Rectangle().fill(.white.opacity(0.14)).frame(width: 0.5, height: 18).padding(.horizontal, 6)
                    }
                    if model.selected == "pet" {
                        StageButton(symbol: "tennisball", help: "扔球（也可以直接点地面）") { model.onCommand?("ball") }
                        StageButton(symbol: "fork.knife", help: "喂能量骨头，恢复电量") { model.onCommand?("feed") }
                        StageButton(symbol: "sparkles", help: "表演才艺（也可以双击小狗）") { model.onCommand?("trick") }
                        StageButton(symbol: (model.pet["activity"] as? String) == "在睡觉" ? "sun.max" : "moon.zzz", help: "睡觉 / 叫醒") { model.onCommand?("sleep") }
                        Rectangle().fill(.white.opacity(0.14)).frame(width: 0.5, height: 18).padding(.horizontal, 6)
                    }
                    StageButton(symbol: model.autoRotate ? "pause.fill" : "rotate.3d", help: model.autoRotate ? "停止自动旋转" : "自动旋转", active: model.autoRotate) { model.autoRotate.toggle() }
                    if model.selected != "pet" {
                        StageButton(symbol: "hand.tap", help: model.selected == "ferrari" ? "互动：转动车轮" : "互动：展翼 · 射击 · 全速推进") { model.onCommand?("action") }
                    }
                    StageButton(symbol: "scope", help: "复位视角") { model.onCommand?("home") }
                    StageButton(symbol: "info.circle", help: "模型来源与许可") { credits = true }
                }.padding(.horizontal, 8).padding(.vertical, 5)
                    .background(.ultraThinMaterial.opacity(0.85), in: Capsule())
                    .overlay(Capsule().strokeBorder(LinearGradient(colors: [.white.opacity(0.28), .white.opacity(0.06)], startPoint: .top, endPoint: .bottom), lineWidth: 0.7))
                    .shadow(color: .black.opacity(0.22), radius: 12, y: 5)
            }.padding(.bottom, 12).animation(.easeOut(duration: 0.2), value: model.selected)
        }.preferredColorScheme(.dark).foregroundStyle(.white).buttonStyle(.plain)
            .popover(isPresented: $credits) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("桌面展品").font(.headline)
                    Text("Ferrari 458 Italia：vicent091036，CC BY 4.0。已解压几何、调整材质与展示比例。\n电子小狗：DeskGlass 用代码程序化建模。\n渲染：three.js，MIT。\n可选本地模型由使用者自行提供；开源仓库和公开安装包不附带高达模型或贴图。")
                        .font(.system(size: 12)).fixedSize(horizontal: false, vertical: true)
                    Link("跑车作者与原模型", destination: URL(string: "https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6")!)
                    Text("资源均随应用保存在本机，展示时无需联网。").font(.caption).foregroundStyle(.secondary)
                }.padding(20).frame(width: 355)
            }
    }
    private func color(_ hex: String) -> Color {
        let value = UInt64(hex.dropFirst(), radix: 16) ?? 0
        return Color(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
    }
}

private struct StageButton: View {
    let symbol: String
    let help: String
    var active = false
    let action: () -> Void
    @State private var hovering = false
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 12, weight: .medium)).frame(width: 28, height: 28)
                .background(Circle().fill(.white.opacity(active ? 0.2 : hovering ? 0.12 : 0)))
                .contentShape(Circle())
        }.help(help).onHover { hovering = $0 }.animation(.easeOut(duration: 0.15), value: hovering)
    }
}

private struct PaintSwatch: View {
    let color: Color
    let selected: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Circle().fill(color).frame(width: 15, height: 15)
                .overlay(Circle().fill(RadialGradient(colors: [.white.opacity(0.55), .clear], center: UnitPoint(x: 0.32, y: 0.28), startRadius: 0, endRadius: 8)))
                .overlay(Circle().strokeBorder(.white.opacity(0.22), lineWidth: 0.5))
                .padding(3.5)
                .overlay(Circle().strokeBorder(.white.opacity(selected ? 0.9 : 0), lineWidth: 1.3))
                .frame(width: 26, height: 26).contentShape(Circle())
        }.animation(.easeOut(duration: 0.15), value: selected)
    }
}
