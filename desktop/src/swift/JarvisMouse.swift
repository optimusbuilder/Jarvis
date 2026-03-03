import Foundation
import CoreGraphics
import Cocoa

// CLI Tool to move the mouse to X,Y and optionally click
// Usage: jarvis-mouse <x> <y> [--click]

func main() {
    let args = CommandLine.arguments

    if args.count < 3 {
        print("Usage: jarvis-mouse <x> <y> [--click]")
        exit(1)
    }

    guard let x = Double(args[1]), let y = Double(args[2]) else {
        print("Error: Invalid coordinates")
        exit(1)
    }

    let shouldClick = args.contains("--click")
    let point = CGPoint(x: x, y: y)

    // 1. Move Mouse
    let moveEvent = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)
    moveEvent?.post(tap: .cghidEventTap)
    
    // We sleep for a tiny fraction of a second to ensure UI elements register the hover state
    // before the click comes in (often required by web browsers).
    Thread.sleep(forTimeInterval: 0.05)

    if shouldClick {
        // 2. Mouse Down
        let mouseDown = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
        mouseDown?.post(tap: .cghidEventTap)
        
        // Brief pause to simulate a real human click duration
        Thread.sleep(forTimeInterval: 0.05)
        
        // 3. Mouse Up
        let mouseUp = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)
        mouseUp?.post(tap: .cghidEventTap)
        print("Clicked at (\(x), \(y))")
    } else {
        print("Moved to (\(x), \(y))")
    }
}

main()
