import Cocoa

// ── Configuration ──
let PANEL_WIDTH: CGFloat = 400
let PANEL_HEIGHT: CGFloat = 200
let CORNER_RADIUS: CGFloat = 12
let PADDING: CGFloat = 16
let FONT_SIZE: CGFloat = 14
let TITLE_FONT_SIZE: CGFloat = 12
let AUTO_DISMISS_SECONDS: Double = 45

// ── Parse arguments ──
let args = CommandLine.arguments
var displayText = "..."
var titleText = "Jarvis Copilot"
var dismissAfter: Double = AUTO_DISMISS_SECONDS

for i in 0..<args.count {
    if args[i] == "--text" && i + 1 < args.count {
        displayText = args[i + 1]
    }
    if args[i] == "--title" && i + 1 < args.count {
        titleText = args[i + 1]
    }
    if args[i] == "--dismiss" && i + 1 < args.count {
        dismissAfter = Double(args[i + 1]) ?? AUTO_DISMISS_SECONDS
    }
}

// ── App Delegate ──
class ContextPanelAppDelegate: NSObject, NSApplicationDelegate {
    var panel: NSPanel!
    var dismissTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Get mouse location in screen coordinates
        let mouseLoc = NSEvent.mouseLocation
        
        // Default position: slightly right and below the cursor
        var panelX = mouseLoc.x + 10
        var panelY = mouseLoc.y - PANEL_HEIGHT - 10
        
        // Ensure the panel doesn't go off-screen
        if let screen = NSScreen.main {
            let screenFrame = screen.visibleFrame
            if panelX + PANEL_WIDTH > screenFrame.maxX {
                panelX = mouseLoc.x - PANEL_WIDTH - 10 // flip to left side of cursor
            }
            if panelY < screenFrame.minY {
                panelY = mouseLoc.y + 10 // flip to above cursor
            }
        }

        // Start position offset for slight slide-up or down animation
        let startPanelY = panelY - 10
        let panelFrame = NSRect(x: panelX, y: startPanelY, width: PANEL_WIDTH, height: PANEL_HEIGHT)
        let finalFrame = NSRect(x: panelX, y: panelY, width: PANEL_WIDTH, height: PANEL_HEIGHT)

        // Create floating panel
        panel = NSPanel(
            contentRect: panelFrame,
            styleMask: [.nonactivatingPanel, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isMovableByWindowBackground = false
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        // Create visual effect view (frosted glass)
        let visualEffect = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: PANEL_WIDTH, height: PANEL_HEIGHT))
        visualEffect.material = .popover
        visualEffect.blendingMode = .behindWindow
        visualEffect.state = .active
        visualEffect.wantsLayer = true
        visualEffect.layer?.cornerRadius = CORNER_RADIUS
        visualEffect.layer?.masksToBounds = true
        
        // Subtle border
        visualEffect.layer?.borderWidth = 1.0
        visualEffect.layer?.borderColor = NSColor(white: 1.0, alpha: 0.2).cgColor

        // Close Button (X)
        let closeButton = NSButton(title: "✕", target: self, action: #selector(closeButtonClicked))
        closeButton.isBordered = false
        closeButton.bezelStyle = .inline
        closeButton.font = NSFont.systemFont(ofSize: 14, weight: .bold)
        closeButton.contentTintColor = NSColor.secondaryLabelColor
        closeButton.frame = NSRect(x: PANEL_WIDTH - 30, y: PANEL_HEIGHT - 30, width: 24, height: 24)
        closeButton.toolTip = "Close (Esc)"

        // Copilot Title label (e.g. "Jarvis Copilot")
        let titleLabel = NSTextField(labelWithString: titleText)
        titleLabel.font = NSFont.systemFont(ofSize: TITLE_FONT_SIZE, weight: .semibold)
        titleLabel.textColor = NSColor.secondaryLabelColor
        let titleHeight = TITLE_FONT_SIZE + 4
        titleLabel.frame = NSRect(x: PADDING, y: PANEL_HEIGHT - PADDING - titleHeight, width: PANEL_WIDTH - 2 * PADDING - 40, height: titleHeight)

        // Response text (main content)
        // Needs a scroll view if text is long
        let scrollView = NSScrollView(frame: NSRect(x: PADDING, y: PADDING, width: PANEL_WIDTH - 2 * PADDING, height: PANEL_HEIGHT - 2 * PADDING - titleHeight - 8))
        let text = NSTextView(frame: scrollView.bounds)
        text.string = displayText
        text.font = NSFont.systemFont(ofSize: FONT_SIZE, weight: .regular)
        text.textColor = NSColor.labelColor
        text.backgroundColor = .clear
        text.isEditable = false
        text.isSelectable = true // Allow selecting the answer!
        text.textContainerInset = NSSize(width: 0, height: 0)
        
        scrollView.documentView = text
        scrollView.hasVerticalScroller = true
        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder

        // Assemble
        visualEffect.addSubview(titleLabel)
        visualEffect.addSubview(closeButton)
        visualEffect.addSubview(scrollView)
        panel.contentView = visualEffect

        // Animation: slide and fade in
        panel.alphaValue = 0
        panel.makeKeyAndOrderFront(nil)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.2
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            panel.animator().setFrame(finalFrame, display: true)
            panel.animator().alphaValue = 1
        }

        // Auto-dismiss timer
        dismissTimer = Timer.scheduledTimer(withTimeInterval: dismissAfter, repeats: false) { [weak self] _ in
            self?.dismissAndExit()
        }

        // Listen for stdin to explicitly close early (e.g., when a new request comes in or Jarvis finishes speaking and user says cancel)
        // Not implemented reading stdin perfectly yet, just simple auto-dismiss for now. Let's add basic stdin reading like JarvisOverlay:
        FileHandle.standardInput.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.count > 0 {
                let str = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
                if str == "CLOSE" {
                    DispatchQueue.main.async {
                        self?.dismissAndExit()
                    }
                }
            } else {
                handle.readabilityHandler = nil
            }
        }

        // Global key monitor for Escape key
        NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.keyCode == 53 { // 53 is the keycode for Escape
                DispatchQueue.main.async {
                    self?.dismissAndExit()
                }
            }
        }
        
        // Local key monitor for Escape key (in case the panel somehow gets focus)
        NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.keyCode == 53 { // 53 is the keycode for Escape
                DispatchQueue.main.async {
                    self?.dismissAndExit()
                }
                return nil // Consume the event
            }
            return event
        }
    }

    @objc func closeButtonClicked() {
        dismissAndExit()
    }

    func dismissAndExit() {
        dismissTimer?.invalidate()
        let closedFrame = NSRect(x: panel.frame.origin.x, y: panel.frame.origin.y + 10, width: PANEL_WIDTH, height: PANEL_HEIGHT)
        
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.2
            context.timingFunction = CAMediaTimingFunction(name: .easeIn)
            panel.animator().setFrame(closedFrame, display: true)
            panel.animator().alphaValue = 0
        }, completionHandler: {
            NSApp.terminate(nil)
        })
    }
}

let app = NSApplication.shared
let delegate = ContextPanelAppDelegate()
app.delegate = delegate
app.run()
