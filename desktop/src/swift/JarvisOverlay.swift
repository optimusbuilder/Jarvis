import Cocoa

// ── Configuration ──
let PANEL_WIDTH: CGFloat = 500
let PANEL_HEIGHT: CGFloat = 160
let CORNER_RADIUS: CGFloat = 16
let PADDING: CGFloat = 20
let BOTTOM_MARGIN: CGFloat = 80
let FONT_SIZE: CGFloat = 15
let TITLE_FONT_SIZE: CGFloat = 13
let AUTO_DISMISS_SECONDS: Double = 30

// ── Parse arguments ──
let args = CommandLine.arguments
var displayText = "..."
var titleText = "Jarvis"
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
class OverlayAppDelegate: NSObject, NSApplicationDelegate {
    var panel: NSPanel!
    var dismissTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Get screen dimensions
        guard let screen = NSScreen.main else {
            NSApp.terminate(nil)
            return
        }
        let screenFrame = screen.visibleFrame

        // Calculate panel position (bottom center)
        let panelX = screenFrame.origin.x + (screenFrame.width - PANEL_WIDTH) / 2
        let panelY = screenFrame.origin.y + BOTTOM_MARGIN
        let panelFrame = NSRect(x: panelX, y: panelY, width: PANEL_WIDTH, height: PANEL_HEIGHT)

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
        visualEffect.material = .hudWindow
        visualEffect.blendingMode = .behindWindow
        visualEffect.state = .active
        visualEffect.wantsLayer = true
        visualEffect.layer?.cornerRadius = CORNER_RADIUS
        visualEffect.layer?.masksToBounds = true

        // Title label (e.g. "Jarvis")
        let titleLabel = NSTextField(labelWithString: titleText)
        titleLabel.font = NSFont.systemFont(ofSize: TITLE_FONT_SIZE, weight: .semibold)
        titleLabel.textColor = NSColor.secondaryLabelColor
        titleLabel.frame = NSRect(x: PADDING, y: PANEL_HEIGHT - PADDING - TITLE_FONT_SIZE - 4, width: PANEL_WIDTH - 2 * PADDING, height: TITLE_FONT_SIZE + 6)

        // Jarvis icon (blue circle)
        let iconSize: CGFloat = 28
        let iconView = NSView(frame: NSRect(x: PADDING, y: PANEL_HEIGHT - PADDING - iconSize, width: iconSize, height: iconSize))
        iconView.wantsLayer = true
        iconView.layer?.cornerRadius = iconSize / 2
        iconView.layer?.backgroundColor = NSColor.systemBlue.cgColor

        // "J" letter in the icon
        let iconLabel = NSTextField(labelWithString: "J")
        iconLabel.font = NSFont.systemFont(ofSize: 14, weight: .bold)
        iconLabel.textColor = .white
        iconLabel.alignment = .center
        iconLabel.frame = NSRect(x: 0, y: 0, width: iconSize, height: iconSize)
        iconView.addSubview(iconLabel)

        // Adjust title position next to icon
        titleLabel.frame = NSRect(x: PADDING + iconSize + 8, y: PANEL_HEIGHT - PADDING - iconSize + (iconSize - TITLE_FONT_SIZE - 4) / 2, width: PANEL_WIDTH - 2 * PADDING - iconSize - 8, height: TITLE_FONT_SIZE + 6)

        // Response text (main content)
        let textView = NSScrollView(frame: NSRect(x: PADDING, y: PADDING, width: PANEL_WIDTH - 2 * PADDING, height: PANEL_HEIGHT - 2 * PADDING - iconSize - 12))
        let text = NSTextView(frame: textView.bounds)
        text.string = displayText
        text.font = NSFont.systemFont(ofSize: FONT_SIZE, weight: .regular)
        text.textColor = NSColor.labelColor
        text.backgroundColor = .clear
        text.isEditable = false
        text.isSelectable = false
        text.textContainerInset = NSSize(width: 0, height: 0)
        textView.documentView = text
        textView.hasVerticalScroller = false
        textView.drawsBackground = false
        textView.borderType = .noBorder

        // Assemble
        visualEffect.addSubview(iconView)
        visualEffect.addSubview(titleLabel)
        visualEffect.addSubview(textView)
        panel.contentView = visualEffect

        // Fade in animation
        panel.alphaValue = 0
        panel.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.3
            panel.animator().alphaValue = 1
        }

        // Auto-dismiss timer
        dismissTimer = Timer.scheduledTimer(withTimeInterval: dismissAfter, repeats: false) { [weak self] _ in
            self?.dismissPanel()
        }

        // Listen for stdin "dismiss" command (so Node.js can close it)
        DispatchQueue.global(qos: .background).async {
            while let line = readLine() {
                if line.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "dismiss" {
                    DispatchQueue.main.async {
                        self.dismissPanel()
                    }
                    break
                }
            }
        }
    }

    func dismissPanel() {
        dismissTimer?.invalidate()
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.3
            panel.animator().alphaValue = 0
        }, completionHandler: {
            NSApp.terminate(nil)
        })
    }
}

// ── Run ──
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = OverlayAppDelegate()
app.delegate = delegate
app.run()
