import Cocoa

// ── Configuration ──
let PANEL_WIDTH: CGFloat = 500
let PANEL_HEIGHT: CGFloat = 160
let CORNER_RADIUS: CGFloat = 16
let PADDING: CGFloat = 20
let BOTTOM_MARGIN: CGFloat = 80
let TOP_MARGIN: CGFloat = 40
let RIGHT_MARGIN: CGFloat = 40
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

        // Calculate panel position (top right)
        let panelX = screenFrame.origin.x + screenFrame.width - PANEL_WIDTH - RIGHT_MARGIN
        let panelY = screenFrame.origin.y + screenFrame.height - PANEL_HEIGHT - TOP_MARGIN
        
        // Start position offset for animation
        let startPanelY = panelY + 20
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
        visualEffect.layer?.cornerRadius = 20
        visualEffect.layer?.masksToBounds = true
        
        // Glowing artistic border
        visualEffect.layer?.borderWidth = 1.0
        visualEffect.layer?.borderColor = NSColor(white: 1.0, alpha: 0.15).cgColor

        // Title label (e.g. "Jarvis") -> We'll repurpose this as a subtitle
        let titleLabel = NSTextField(labelWithString: titleText == "Jarvis" ? "Voice Assistant" : titleText)
        let titleFont = NSFont(name: "AvenirNext-Medium", size: TITLE_FONT_SIZE) ?? NSFont.systemFont(ofSize: TITLE_FONT_SIZE, weight: .medium)
        titleLabel.font = titleFont
        titleLabel.textColor = NSColor.secondaryLabelColor
        titleLabel.isBordered = false
        titleLabel.drawsBackground = false
        titleLabel.isEditable = false

        // Jarvis icon (gradient pill instead of circle)
        let iconWidth: CGFloat = 64
        let iconHeight: CGFloat = 24
        let iconView = NSView(frame: NSRect(x: PADDING, y: PANEL_HEIGHT - PADDING - iconHeight, width: iconWidth, height: iconHeight))
        iconView.wantsLayer = true
        iconView.layer?.cornerRadius = iconHeight / 2
        
        // Setup gradient layer
        let gradientLayer = CAGradientLayer()
        gradientLayer.frame = iconView.bounds
        gradientLayer.colors = [
            NSColor(red: 0.1, green: 0.8, blue: 0.9, alpha: 1.0).cgColor, // Electric Cyan
            NSColor(red: 0.4, green: 0.1, blue: 0.9, alpha: 1.0).cgColor  // Deep Violet
        ]
        gradientLayer.startPoint = CGPoint(x: 0.0, y: 0.5)
        gradientLayer.endPoint = CGPoint(x: 1.0, y: 0.5)
        iconView.layer?.addSublayer(gradientLayer)

        // "JARVIS" text inside the pill
        let iconLabel = NSTextField(labelWithString: "JARVIS")
        iconLabel.font = NSFont.systemFont(ofSize: 11, weight: .heavy)
        iconLabel.textColor = .white
        iconLabel.alignment = .center
        iconLabel.isBordered = false
        iconLabel.drawsBackground = false
        iconLabel.isEditable = false
        
        // Vertically center the text properly
        let iconLabelHeight: CGFloat = 16
        iconLabel.frame = NSRect(x: 0, y: (iconHeight - iconLabelHeight) / 2 - 1, width: iconWidth, height: iconLabelHeight)
        iconView.addSubview(iconLabel)

        // Adjust title position next to the pill
        titleLabel.frame = NSRect(x: PADDING + iconWidth + 10, y: PANEL_HEIGHT - PADDING - iconHeight + (iconHeight - TITLE_FONT_SIZE - 4) / 2, width: PANEL_WIDTH - 2 * PADDING - iconWidth - 10, height: TITLE_FONT_SIZE + 6)

        // Response text (main content)
        let textView = NSScrollView(frame: NSRect(x: PADDING, y: PADDING, width: PANEL_WIDTH - 2 * PADDING, height: PANEL_HEIGHT - 2 * PADDING - iconHeight - 12))
        let text = NSTextView(frame: textView.bounds)
        text.string = displayText
        let textFont = NSFont(name: "AvenirNext-Regular", size: FONT_SIZE) ?? NSFont.systemFont(ofSize: FONT_SIZE, weight: .regular)
        text.font = textFont
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

        // Slide down and fade in animation
        panel.alphaValue = 0
        panel.orderFrontRegardless()
        
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.4
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            panel.animator().alphaValue = 1
            panel.animator().setFrame(finalFrame, display: true)
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
