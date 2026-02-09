import AppKit
import Foundation

@MainActor
final class WindowCloseDelegate: NSObject, NSWindowDelegate {
    weak var workspace: WorkspaceState?
    private var bypassNextClose = false
    private var isConfirmingClose = false
    private var frameSaveWorkItem: DispatchWorkItem?
    private let frameSaveDelay: TimeInterval = 0.25

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        guard let workspace else { return true }
        if workspace.shouldBypassCloseGuards() {
            workspace.persistSessionState()
            return true
        }
        if bypassNextClose {
            bypassNextClose = false
            return true
        }
        guard !isConfirmingClose else { return false }
        isConfirmingClose = true
        Task { @MainActor in
            defer { isConfirmingClose = false }
            let shouldClose = await workspace.confirmCloseForWindow()
            if shouldClose {
                workspace.persistSessionState()
                bypassNextClose = true
                sender.performClose(nil)
            }
        }
        return false
    }

    func windowDidMove(_ notification: Notification) {
        guard let window = notification.object as? NSWindow else { return }
        scheduleFramePersist(window)
    }

    func windowDidResize(_ notification: Notification) {
        guard let window = notification.object as? NSWindow else { return }
        scheduleFramePersist(window)
    }

    private func scheduleFramePersist(_ window: NSWindow) {
        frameSaveWorkItem?.cancel()
        let workItem = DispatchWorkItem { [weak self, weak window] in
            guard let self, let window else { return }
            self.persistWindowFrame(window)
        }
        frameSaveWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + frameSaveDelay, execute: workItem)
    }

    private func persistWindowFrame(_ window: NSWindow) {
        WindowFrameStore.saveFrame(window.frame, for: workspace?.rootDirectory)
    }
}

@MainActor
final class SmithersAppDelegate: NSObject, NSApplicationDelegate {
    weak var workspace: WorkspaceState? {
        didSet {
            ipcServer.configure(workspace: workspace)
            flushPendingOpenRequests()
        }
    }
    private var terminationInProgress = false
    private var pendingOpenURLs: [URL] = []
    private let ipcServer = SmithersIPCServer()

    func applicationDidFinishLaunching(_ notification: Notification) {
        PressAndHoldDisabler.disable()
    }

    func application(_ sender: NSApplication, openFile filename: String) -> Bool {
        handleOpenURLs([URL(fileURLWithPath: filename)])
        return true
    }

    func application(_ sender: NSApplication, openFiles filenames: [String]) {
        handleOpenURLs(filenames.map { URL(fileURLWithPath: $0) })
        sender.reply(toOpenOrPrint: .success)
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        handleOpenURLs(urls)
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let workspace else { return .terminateNow }
        if terminationInProgress {
            return .terminateLater
        }
        terminationInProgress = true
        Task { @MainActor in
            let shouldTerminate = await workspace.confirmCloseForApplication()
            if shouldTerminate {
                workspace.persistSessionState()
                workspace.setCloseGuardsBypassed(true)
                ipcServer.notifyAllWaiters(message: "Application terminating")
                ipcServer.stop()
            }
            self.terminationInProgress = false
            NSApp.reply(toApplicationShouldTerminate: shouldTerminate)
        }
        return .terminateLater
    }

    var hasPendingOpenRequests: Bool {
        !pendingOpenURLs.isEmpty
    }

    private func handleOpenURLs(_ urls: [URL]) {
        guard !urls.isEmpty else { return }
        guard let workspace else {
            pendingOpenURLs.append(contentsOf: urls)
            return
        }
        var fileURLs: [URL] = []
        var schemeURLs: [URL] = []
        for url in urls {
            if url.isFileURL {
                fileURLs.append(url)
            } else {
                schemeURLs.append(url)
            }
        }
        if !fileURLs.isEmpty {
            workspace.handleExternalOpen(urls: fileURLs)
        }
        for url in schemeURLs {
            _ = workspace.handleOpenURL(url)
        }
    }

    private func flushPendingOpenRequests() {
        guard !pendingOpenURLs.isEmpty else { return }
        let urls = pendingOpenURLs
        pendingOpenURLs.removeAll()
        handleOpenURLs(urls)
    }
}
