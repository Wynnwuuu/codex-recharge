import AppKit
import WebKit

/// A lightweight native host. All animation and layout live in the shared React view.
final class CompanionPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    // The transparent tooltip reserve can cross an edge; only the companion canvas is clamped.
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

final class DesktopCompanion: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    private var panel: CompanionPanel!
    private var webView: WKWebView!
    private var statusItem: NSStatusItem!
    private var statusTimer: Timer?
    private var dragTimer: Timer?
    private var dragMouseOrigin = NSPoint.zero
    private var dragAnchorOrigin = NSPoint.zero
    // This point identifies the companion canvas, independent of tooltip direction.
    private var companionAnchor = NSPoint.zero
    private enum TooltipPlacement: String { case above, below }
    private var tooltipPlacement: TooltipPlacement = .below
    private let companionSize = NSSize(width: 180, height: 135)
    private var panelHeight: CGFloat = 240
    private var tooltipSpace: CGFloat { panelHeight - companionSize.height - 8 }
    private var isApplyingLayout = false
    private var screenObservers: [NSObjectProtocol] = []
    private let anchorXKey = "CodexRechargeAnchorX"
    private let anchorYKey = "CodexRechargeAnchorY"
    private var placementChecks: [String: Bool] = [:]
    private var cachedStatus: [String: Any]?
    private var statusInFlight = false
    private var isTerminating = false
    private var telemetryProcess: Process?
    private let worker = DispatchQueue(label: "cc.motionface.codex-recharge.telemetry", qos: .utility)
    private let arguments = CommandLine.arguments
    private var selfTest: Bool { arguments.contains("--self-test") }
    private var diagnosticRun: Bool { selfTest || arguments.contains("--placement-test") || argumentValue("--test-placement") != nil }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        makePanel()
        makeMenu()
        loadFrontend()
        statusTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            self?.refreshStatus()
        }
    }

    private func makePanel() {
        let size = NSSize(width: 180, height: 240)
        panel = CompanionPanel(contentRect: NSRect(origin: .zero, size: size),
                               styleMask: [.borderless, .nonactivatingPanel],
                               backing: .buffered, defer: false)
        panel.title = "Codex Recharge"
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = false
        panel.acceptsMouseMovedEvents = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.isReleasedWhenClosed = false

        let defaults = UserDefaults.standard
        if defaults.object(forKey: anchorXKey) != nil && defaults.object(forKey: anchorYKey) != nil {
            companionAnchor = NSPoint(x: defaults.double(forKey: anchorXKey), y: defaults.double(forKey: anchorYKey))
        } else if panel.setFrameUsingName("CodexRechargePanel") {
            // Upgrade the old top-aligned canvas without moving the companion itself.
            companionAnchor = NSPoint(x: panel.frame.minX, y: panel.frame.minY + 97)
        } else {
            let visible = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1200, height: 800)
            companionAnchor = NSPoint(x: visible.maxX - size.width - 24, y: visible.minY + 24)
        }
        panel.setContentSize(size)
        updateLayout(publish: false)

        let contentController = WKUserContentController()
        contentController.add(self, name: "codex")
        contentController.addUserScript(WKUserScript(source:
            "Object.defineProperty(window, 'codexDesktop', {value: true}); window.__codexTooltipPlacement = '\(tooltipPlacement.rawValue)'; window.__codexDesktopHeight = \(Int(panelHeight)); window.__codexHostErrorCount = 0; window.addEventListener('error', () => window.__codexHostErrorCount++); window.addEventListener('unhandledrejection', () => window.__codexHostErrorCount++);",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        webView = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: configuration)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        webView.wantsLayer = true
        webView.layer?.backgroundColor = NSColor.clear.cgColor
        panel.contentView = webView

        let center = NotificationCenter.default
        screenObservers.append(center.addObserver(forName: NSApplication.didChangeScreenParametersNotification,
            object: nil, queue: .main) { [weak self] _ in self?.updateLayout() })
        screenObservers.append(center.addObserver(forName: NSWindow.didChangeScreenNotification,
            object: panel, queue: .main) { [weak self] _ in
                guard let self = self, !self.isApplyingLayout else { return }
                self.updateLayout()
            })
        panel.orderFrontRegardless()
    }

    private func makeMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(systemSymbolName: "bolt.circle.fill", accessibilityDescription: "Codex Recharge")
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "打开 Codex", action: #selector(openCodex), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "显示 / 隐藏悬浮窗", action: #selector(togglePanel), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "刷新用量", action: #selector(refreshFromMenu), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "退出 Codex Recharge", action: #selector(quit), keyEquivalent: "q"))
        for item in menu.items { item.target = self }
        statusItem.menu = menu
    }

    private func loadFrontend() {
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true),
              FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else {
            showHostError("找不到界面资源，请先运行 npm run build，再构建桌面应用。")
            if selfTest { finishSelfTest(1) }
            return
        }
        webView.loadFileURL(root.appendingPathComponent("index.html"), allowingReadAccessTo: root)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        publishLayout()
        if let status = cachedStatus { publish(status) }
        refreshStatus()
        if selfTest || argumentValue("--screenshot") != nil {
            awaitStatusForCapture(deadline: Date().addingTimeInterval(20))
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if selfTest { fputs("Frontend navigation failed.\n", stderr); finishSelfTest(1) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // Bundled files and generated in-page resources are the only navigation targets.
        let scheme = navigationAction.request.url?.scheme?.lowercased()
        decisionHandler(scheme == "file" || scheme == "about" || scheme == "blob" ? .allow : .cancel)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.name == "codex",
              let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
        switch action {
        case "openCodex": openCodex()
        case "getLayout": updateLayout()
        case "setTooltipHeight":
            if let value = body["height"] as? NSNumber, value.doubleValue.isFinite {
                let tooltipHeight = min(max(CGFloat(value.doubleValue), 40), 400)
                let height = max(240, companionSize.height + 8 + ceil(tooltipHeight) + 8)
                if height != panelHeight { panelHeight = height; updateLayout() }
            }
        case "getStatus":
            if let status = cachedStatus { publish(status) }
            refreshStatus()
        case "drag":
            if body["phase"] as? String == "end" { stopDragging() }
            else { startDragging() }
        default: break
        }
    }

    private func startDragging() {
        guard dragTimer == nil, NSEvent.pressedMouseButtons & 1 != 0 else { return }
        dragMouseOrigin = NSEvent.mouseLocation
        dragAnchorOrigin = companionAnchor
        dragTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            guard NSEvent.pressedMouseButtons & 1 != 0 else { self.stopDragging(); return }
            let pointer = NSEvent.mouseLocation
            self.companionAnchor = NSPoint(x: self.dragAnchorOrigin.x + pointer.x - self.dragMouseOrigin.x,
                                           y: self.dragAnchorOrigin.y + pointer.y - self.dragMouseOrigin.y)
            self.updateLayout()
        }
        RunLoop.main.add(dragTimer!, forMode: .eventTracking)
    }

    private func stopDragging() {
        dragTimer?.invalidate()
        dragTimer = nil
        persistAnchor()
    }

    private func persistAnchor() {
        guard !diagnosticRun else { return }
        UserDefaults.standard.set(Double(companionAnchor.x), forKey: anchorXKey)
        UserDefaults.standard.set(Double(companionAnchor.y), forKey: anchorYKey)
    }

    private func screenForCompanion() -> NSScreen? {
        let center = NSPoint(x: companionAnchor.x + companionSize.width / 2,
                             y: companionAnchor.y + companionSize.height / 2)
        if let screen = NSScreen.screens.first(where: { $0.frame.contains(center) }) { return screen }
        // A disconnected display or a gap between displays should resolve to the nearest screen.
        return NSScreen.screens.min { lhs, rhs in
            func distance(_ screen: NSScreen) -> CGFloat {
                let rect = screen.visibleFrame
                let dx = max(rect.minX - center.x, 0, center.x - rect.maxX)
                let dy = max(rect.minY - center.y, 0, center.y - rect.maxY)
                return dx * dx + dy * dy
            }
            return distance(lhs) < distance(rhs)
        }
    }

    private var canvasOffset: CGFloat { tooltipPlacement == .above ? 8 : tooltipSpace }

    private func updateLayout(publish shouldPublish: Bool = true) {
        guard !isApplyingLayout, let screen = screenForCompanion() else { return }
        isApplyingLayout = true
        defer { isApplyingLayout = false }
        let visible = screen.visibleFrame
        companionAnchor.x = min(max(companionAnchor.x, visible.minX), max(visible.minX, visible.maxX - companionSize.width))
        companionAnchor.y = min(max(companionAnchor.y, visible.minY), max(visible.minY, visible.maxY - companionSize.height))
        let below = companionAnchor.y - visible.minY
        let above = visible.maxY - companionAnchor.y - companionSize.height
        // Prefer the side with room; this also follows the screen half when both sides fit.
        if below < tooltipSpace && above >= tooltipSpace { tooltipPlacement = .above }
        else if above < tooltipSpace && below >= tooltipSpace { tooltipPlacement = .below }
        else { tooltipPlacement = above >= below ? .above : .below }
        applyPanelFrame()
        if shouldPublish { publishLayout() }
    }

    private func applyPanelFrame() {
        let frame = NSRect(x: companionAnchor.x, y: companionAnchor.y - canvasOffset,
                           width: companionSize.width, height: panelHeight)
        if panel.frame != frame { panel.setFrame(frame, display: false) }
    }

    private func publishLayout() {
        let script = "window.__codexTooltipPlacement = '\(tooltipPlacement.rawValue)'; window.__codexDesktopHeight = \(Int(panelHeight)); window.dispatchEvent(new CustomEvent('codex-layout', {detail: {placement: window.__codexTooltipPlacement, panelHeight: window.__codexDesktopHeight}}));"
        webView?.evaluateJavaScript(script, completionHandler: nil)
    }

    private func discoverNode() -> URL? {
        let bundled = Bundle.main.resourceURL?.appendingPathComponent("runtime/node")
        let pathCandidates = (ProcessInfo.processInfo.environment["PATH"] ?? "")
            .split(separator: ":").map { String($0) + "/node" }
        let candidates = [bundled?.path].compactMap { $0 } + pathCandidates + [
            "/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"
        ]
        return candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }).map(URL.init(fileURLWithPath:))
    }

    private func refreshStatus() {
        guard !statusInFlight else { return }
        guard let node = discoverNode(),
              let script = Bundle.main.resourceURL?.appendingPathComponent("telemetry/cli.mjs"),
              FileManager.default.fileExists(atPath: script.path) else {
            publishUnavailable("Node.js 或用量读取组件不可用")
            return
        }
        statusInFlight = true
        let support = FileManager.default.temporaryDirectory
            .appendingPathComponent("cc.motionface.codex-recharge", isDirectory: true)
        let process = Process()
        process.executableURL = node
        process.arguments = [script.path, "--watch", "--interval", "30000"]
        var environment = ProcessInfo.processInfo.environment
        environment["CODEX_RECHARGE_DATA_DIR"] = support.path
        process.environment = environment
        let stdout = Pipe()
        process.standardOutput = stdout
        process.standardError = FileHandle.nullDevice
        process.standardInput = FileHandle.nullDevice
        telemetryProcess = process
        worker.async { [weak self] in
            do {
                try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
                try process.run()
                var pending = Data()
                while true {
                    let chunk = stdout.fileHandleForReading.availableData
                    if chunk.isEmpty { break }
                    pending.append(chunk)
                    while let newline = pending.firstIndex(of: 10) {
                        let line = pending.prefix(upTo: newline)
                        pending.removeSubrange(...newline)
                        if let status = (try? JSONSerialization.jsonObject(with: Data(line))) as? [String: Any] {
                            DispatchQueue.main.async { self?.publish(status) }
                        }
                    }
                    // Reject an invalid/unbounded child output stream without keeping it in memory.
                    if pending.count > 1_048_576 { process.terminate(); break }
                }
                process.waitUntilExit()
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    self.statusInFlight = false
                    self.telemetryProcess = nil
                    if !self.isTerminating { self.publishUnavailable("暂时无法读取 Codex 状态") }
                }
            } catch {
                DispatchQueue.main.async {
                    self?.statusInFlight = false
                    self?.telemetryProcess = nil
                    self?.publishUnavailable("暂时无法读取 Codex 状态")
                }
            }
        }
    }

    private func publishUnavailable(_ message: String) {
        publish(["remainingPercent": NSNull(), "activeTasks": NSNull(),
                 "windows": [], "usageStatus": "unavailable", "tasksStatus": "unavailable",
                 "updatedAt": ISO8601DateFormatter().string(from: Date()), "source": "native-host", "error": message])
    }

    private func publish(_ status: [String: Any]) {
        cachedStatus = status
        guard let encoded = try? JSONSerialization.data(withJSONObject: status),
              let json = String(data: encoded, encoding: .utf8) else { return }
        let script = "window.__codexInitialStatus = \(json); window.dispatchEvent(new CustomEvent('codex-status', {detail: window.__codexInitialStatus}));"
        webView?.evaluateJavaScript(script, completionHandler: nil)
        if let value = status["remainingPercent"] as? NSNumber {
            statusItem?.button?.toolTip = "Codex 剩余用量 \(value.intValue)%"
        } else { statusItem?.button?.toolTip = "Codex Recharge · 用量暂不可用" }
    }

    @objc private func openCodex() {
        let workspace = NSWorkspace.shared
        if let applicationURL = workspace.urlForApplication(withBundleIdentifier: "com.openai.codex") {
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = true
            workspace.openApplication(at: applicationURL, configuration: configuration, completionHandler: nil)
        } else if let url = URL(string: "codex://") { workspace.open(url) }
    }

    @objc private func togglePanel() {
        if panel.isVisible { panel.orderOut(nil) }
        else { panel.orderFrontRegardless() }
    }
    @objc private func refreshFromMenu() {
        if telemetryProcess?.isRunning == true {
            telemetryProcess?.terminate()
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in self?.refreshStatus() }
        } else { refreshStatus() }
    }
    @objc private func quit() { NSApp.terminate(nil) }

    func applicationWillTerminate(_ notification: Notification) {
        isTerminating = true
        statusTimer?.invalidate()
        stopDragging()
        for observer in screenObservers { NotificationCenter.default.removeObserver(observer) }
        if telemetryProcess?.isRunning == true { telemetryProcess?.terminate() }
    }

    private func argumentValue(_ flag: String) -> String? {
        guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else { return nil }
        return arguments[index + 1]
    }

    private func awaitStatusForCapture(deadline: Date) {
        if cachedStatus != nil || Date() >= deadline {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.prepareCaptureAndTest() }
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in self?.awaitStatusForCapture(deadline: deadline) }
        }
    }

    private func prepareCaptureAndTest() {
        if arguments.contains("--placement-test") {
            let screens = NSScreen.screens
            guard !screens.isEmpty else { finishSelfTest(1); return }
            let originalAnchor = companionAnchor
            runPlacementTests(screens: screens, index: 0) { [weak self] in
                guard let self = self else { return }
                self.companionAnchor = originalAnchor
                self.updateLayout()
                self.configureCapturePlacement()
            }
        } else { configureCapturePlacement() }
    }

    private func configureCapturePlacement() {
        if let requested = argumentValue("--test-placement"), let screen = screenForCompanion() {
            let visible = screen.visibleFrame
            companionAnchor.x = visible.maxX - companionSize.width - 24
            companionAnchor.y = requested == "above" ? visible.minY + 12 : visible.maxY - companionSize.height - 12
            updateLayout()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.captureAndTest() }
    }

    private func probeLayout(completion: @escaping ([String: Any]) -> Void) {
        let script = """
        (() => {
          const companion = document.querySelector('.companion');
          const tooltip = document.querySelector('.tooltip');
          if (!companion || !tooltip) return {rendered: false};
          tooltip.style.opacity = '1'; tooltip.style.transform = 'translate(-50%, 0)';
          const c = companion.getBoundingClientRect(), t = tooltip.getBoundingClientRect();
          const placement = window.__codexTooltipPlacement;
          return {rendered: true, left: c.left, bottom: c.bottom,
            tooltipLeft: t.left, tooltipTop: t.top, tooltipRight: t.right, tooltipBottom: t.bottom,
            viewportMatches: innerHeight === window.__codexDesktopHeight,
            bridgeMatches: document.querySelector('.desktop')?.dataset.placement === placement,
            tooltipInside: t.left >= -0.5 && t.right <= innerWidth + 0.5 && t.top >= -0.5 && t.bottom <= innerHeight + 0.5,
            correctSide: placement === 'above' ? t.bottom <= c.top + c.height / 2 : t.top >= c.top + c.height / 2};
        })()
        """
        webView.evaluateJavaScript(script) { value, error in
            completion(error == nil ? (value as? [String: Any] ?? [:]) : [:])
        }
    }

    private func canvasScreenOrigin(_ probe: [String: Any]) -> NSPoint? {
        guard let left = probe["left"] as? NSNumber, let bottom = probe["bottom"] as? NSNumber else { return nil }
        return NSPoint(x: panel.frame.minX + CGFloat(left.doubleValue),
                       y: panel.frame.maxY - CGFloat(bottom.doubleValue))
    }

    private func runPlacementTests(screens: [NSScreen], index: Int, completion: @escaping () -> Void) {
        guard index < screens.count * 2 else { completion(); return }
        let screen = screens[index / 2]
        let visible = screen.visibleFrame
        let expected: TooltipPlacement = index % 2 == 0 ? .above : .below
        companionAnchor = NSPoint(x: visible.midX - companionSize.width / 2,
            y: expected == .above ? visible.minY + 12 : visible.maxY - companionSize.height - 12)
        // Start on the opposite side at this exact anchor, then let the screen logic flip it.
        tooltipPlacement = expected == .above ? .below : .above
        applyPanelFrame()
        publishLayout()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
            guard let self = self else { return }
            self.probeLayout { before in
                let beforeOrigin = self.canvasScreenOrigin(before)
                self.updateLayout()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                    self.probeLayout { after in
                        let afterOrigin = self.canvasScreenOrigin(after)
                        let stable: Bool
                        if let beforeOrigin = beforeOrigin, let afterOrigin = afterOrigin {
                            stable = abs(beforeOrigin.x - afterOrigin.x) < 0.5 && abs(beforeOrigin.y - afterOrigin.y) < 0.5
                                && abs(afterOrigin.x - self.companionAnchor.x) < 0.5 && abs(afterOrigin.y - self.companionAnchor.y) < 0.5
                        } else { stable = false }
                        let prefix = "screen\(index / 2 + 1)_\(expected.rawValue)"
                        self.placementChecks[prefix + "_placement"] = self.tooltipPlacement == expected
                        self.placementChecks[prefix + "_anchorStable"] = stable
                        self.placementChecks[prefix + "_tooltipInside"] = after["tooltipInside"] as? Bool == true
                        if let left = after["tooltipLeft"] as? NSNumber, let top = after["tooltipTop"] as? NSNumber,
                           let right = after["tooltipRight"] as? NSNumber, let bottom = after["tooltipBottom"] as? NSNumber {
                            let tooltipRect = NSRect(x: self.panel.frame.minX + CGFloat(left.doubleValue),
                                y: self.panel.frame.maxY - CGFloat(bottom.doubleValue),
                                width: CGFloat(right.doubleValue - left.doubleValue),
                                height: CGFloat(bottom.doubleValue - top.doubleValue))
                            self.placementChecks[prefix + "_screenVisible"] = visible.insetBy(dx: -0.5, dy: -0.5).contains(tooltipRect)
                        } else { self.placementChecks[prefix + "_screenVisible"] = false }
                        self.placementChecks[prefix + "_correctSide"] = after["correctSide"] as? Bool == true
                        self.placementChecks[prefix + "_bridge"] = after["bridgeMatches"] as? Bool == true && after["viewportMatches"] as? Bool == true
                        self.runPlacementTests(screens: screens, index: index + 1, completion: completion)
                    }
                }
            }
        }
    }

    private func captureAndTest() {
        let testScript = """
        (() => {
          const status = window.__codexInitialStatus;
          const pet = document.querySelector('.pet');
          const label = pet?.getAttribute('aria-label') || '';
          const tooltip = document.querySelector('.tooltip');
          if (tooltip && (\(arguments.contains("--placement-test")) || \(argumentValue("--test-placement") != nil))) {
            tooltip.style.opacity = '1'; tooltip.style.transform = 'translate(-50%, 0)';
          }
          return {desktop: window.codexDesktop === true, loaded: document.readyState === 'complete',
            rendered: !!pet, statusReceived: !!status, errorCount: window.__codexHostErrorCount || 0,
            usageStatus: status?.usageStatus || 'missing', tasksStatus: status?.tasksStatus || 'missing',
            usageBound: typeof status?.remainingPercent === 'number' && label.includes(Math.round(status.remainingPercent) + '%'),
            tasksBound: typeof status?.activeTasks === 'number' && label.includes(status.activeTasks + ' 个任务'),
            width: innerWidth, height: innerHeight};
        })()
        """
        webView.evaluateJavaScript(testScript) { [weak self] value, error in
            guard let self = self else { return }
            if let result = value as? [String: Any], let json = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]),
               let diagnostics = String(data: json, encoding: .utf8) { print("Desktop diagnostics: \(diagnostics)") }
            if !self.placementChecks.isEmpty {
                if let data = try? JSONSerialization.data(withJSONObject: self.placementChecks, options: [.sortedKeys]),
                   let diagnostics = String(data: data, encoding: .utf8) { print("Desktop placement diagnostics: \(diagnostics)") }
                if self.placementChecks.values.contains(false) {
                    fputs("Desktop adaptive placement self-test failed.\n", stderr)
                    self.finishSelfTest(1)
                    return
                }
            }
            if let error = error as NSError? { print("Desktop JavaScript error: \(error.domain) \(error.code)") }
            guard error == nil, let result = value as? [String: Any], result["desktop"] as? Bool == true,
                  result["loaded"] as? Bool == true, result["rendered"] as? Bool == true,
                  result["statusReceived"] as? Bool == true else {
                fputs("Desktop bridge self-test failed.\n", stderr)
                if self.selfTest { self.finishSelfTest(1) }
                return
            }
            if self.arguments.contains("--require-live-status") &&
                (result["usageStatus"] as? String != "live" || result["tasksStatus"] as? String != "live" ||
                 result["usageBound"] as? Bool != true || result["tasksBound"] as? Bool != true) {
                fputs("Desktop live status binding self-test failed.\n", stderr)
                self.finishSelfTest(1)
                return
            }
            guard let path = self.argumentValue("--screenshot") else {
                print("Desktop bridge, React view, and status delivery self-test passed (\(Int(self.webView.bounds.width)) x \(Int(self.webView.bounds.height))).")
                if self.selfTest { self.finishSelfTest(0) }
                return
            }
            let configuration = WKSnapshotConfiguration()
            configuration.snapshotWidth = NSNumber(value: Double(self.webView.bounds.width))
            self.webView.takeSnapshot(with: configuration) { image, snapshotError in
                guard snapshotError == nil, let data = image?.tiffRepresentation,
                      let bitmap = NSBitmapImageRep(data: data), let png = bitmap.representation(using: .png, properties: [:]) else {
                    fputs("Desktop screenshot failed.\n", stderr)
                    if self.selfTest { self.finishSelfTest(1) }
                    return
                }
                do {
                    try png.write(to: URL(fileURLWithPath: path))
                    print("Desktop bridge, React view, and status delivery self-test passed; screenshot saved.")
                    if self.selfTest { self.finishSelfTest(0) }
                } catch {
                    fputs("Desktop screenshot could not be written.\n", stderr)
                    if self.selfTest { self.finishSelfTest(1) }
                }
            }
        }
    }

    private func finishSelfTest(_ code: Int32) {
        isTerminating = true
        statusTimer?.invalidate()
        stopDragging()
        if telemetryProcess?.isRunning == true { telemetryProcess?.terminate() }
        awaitTelemetryExit(code: code, deadline: Date().addingTimeInterval(3))
    }

    private func awaitTelemetryExit(code: Int32, deadline: Date) {
        if telemetryProcess?.isRunning != true { exit(code) }
        if Date() >= deadline {
            if let pid = telemetryProcess?.processIdentifier { kill(pid, SIGKILL) }
            exit(code)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in self?.awaitTelemetryExit(code: code, deadline: deadline) }
    }

    private func showHostError(_ message: String) {
        webView.loadHTMLString("<body style='font:14px -apple-system;color:#eee;background:#282632;border-radius:24px;padding:24px'>\(message)</body>", baseURL: nil)
    }
}

let application = NSApplication.shared
let delegate = DesktopCompanion()
application.delegate = delegate
withExtendedLifetime(delegate) { application.run() }
