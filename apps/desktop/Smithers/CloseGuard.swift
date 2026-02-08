import AppKit

@MainActor
final class WindowCloseDelegate: NSObject, NSWindowDelegate {
    weak var workspace: WorkspaceState?
    private var bypassNextClose = false

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        guard let workspace else { return true }
        if workspace.shouldBypassCloseGuards() {
            return true
        }
        if bypassNextClose {
            bypassNextClose = false
            return true
        }
        Task { @MainActor in
            let shouldClose = await workspace.confirmCloseForWindow()
            if shouldClose {
                bypassNextClose = true
                sender.performClose(nil)
            }
        }
        return false
    }
}

@MainActor
final class SmithersAppDelegate: NSObject, NSApplicationDelegate {
    weak var workspace: WorkspaceState?
    private var terminationInProgress = false

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let workspace else { return .terminateNow }
        if terminationInProgress {
            return .terminateLater
        }
        terminationInProgress = true
        Task { @MainActor in
            let shouldTerminate = await workspace.confirmCloseForApplication()
            if shouldTerminate {
                workspace.setCloseGuardsBypassed(true)
            }
            self.terminationInProgress = false
            NSApp.reply(toApplicationShouldTerminate: shouldTerminate)
        }
        return .terminateLater
    }
}
