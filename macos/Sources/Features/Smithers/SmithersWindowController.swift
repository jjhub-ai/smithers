import AppKit
import SwiftUI

class SmithersWindowController: NSWindowController {
    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1000, height: 600),
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Smithers"
        window.center()
        window.contentView = NSHostingView(rootView: SmithersView())

        self.init(window: window)
    }

    static func createWindow() -> SmithersWindowController {
        let controller = SmithersWindowController()
        controller.showWindow(nil)
        return controller
    }
}
