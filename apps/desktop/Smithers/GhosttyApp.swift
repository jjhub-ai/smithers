import AppKit
import GhosttyKit
import QuartzCore

final class GhosttyApp {
    static let shared = GhosttyApp()

    private(set) var app: ghostty_app_t?
    private var config: ghostty_config_t?
    private var tickScheduled = false

    private init() {
        if ghostty_init(UInt(CommandLine.argc), CommandLine.unsafeArgv) != GHOSTTY_SUCCESS {
            print("ghostty_init failed")
        }
        let config = ghostty_config_new()
        self.config = config
        if config != nil {
            ghostty_config_load_default_files(config)
            ghostty_config_finalize(config)
        }

        var runtime = ghostty_runtime_config_s(
            userdata: Unmanaged.passUnretained(self).toOpaque(),
            supports_selection_clipboard: false,
            wakeup_cb: { userdata in GhosttyApp.wakeup(userdata) },
            action_cb: { app, target, action in GhosttyApp.action(app, target: target, action: action) },
            read_clipboard_cb: { userdata, location, state in GhosttyApp.readClipboard(userdata, location: location, state: state) },
            confirm_read_clipboard_cb: { userdata, string, state, request in
                GhosttyApp.confirmReadClipboard(userdata, string: string, state: state, request: request)
            },
            write_clipboard_cb: { userdata, location, content, len, confirm in
                GhosttyApp.writeClipboard(userdata, location: location, content: content, len: len, confirm: confirm)
            },
            close_surface_cb: { userdata, processAlive in GhosttyApp.closeSurface(userdata, processAlive: processAlive) }
        )

        if let config {
            app = ghostty_app_new(&runtime, config)
            if app == nil {
                print("ghostty_app_new failed")
            }
        }

        if let app {
            let isActive = NSApp?.isActive ?? false
            ghostty_app_set_focus(app, isActive)
        }

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidBecomeActive(_:)),
            name: NSApplication.didBecomeActiveNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidResignActive(_:)),
            name: NSApplication.didResignActiveNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardSelectionDidChange(_:)),
            name: NSTextInputContext.keyboardSelectionDidChangeNotification,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        if let app {
            ghostty_app_free(app)
        }
        if let config {
            ghostty_config_free(config)
        }
    }

    func scheduleTick() {
        if tickScheduled { return }
        tickScheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.tickScheduled = false
            if let app = self.app {
                ghostty_app_tick(app)
            }
        }
    }

    @objc private func appDidBecomeActive(_ note: Notification) {
        guard let app else { return }
        ghostty_app_set_focus(app, true)
    }

    @objc private func appDidResignActive(_ note: Notification) {
        guard let app else { return }
        ghostty_app_set_focus(app, false)
    }

    @objc private func keyboardSelectionDidChange(_ note: Notification) {
        guard let app else { return }
        ghostty_app_keyboard_changed(app)
    }

    // MARK: - C Callbacks

    private static func wakeup(_ userdata: UnsafeMutableRawPointer?) {
        guard let userdata else { return }
        let app = Unmanaged<GhosttyApp>.fromOpaque(userdata).takeUnretainedValue()
        app.scheduleTick()
    }

    private static func action(
        _ app: ghostty_app_t?,
        target: ghostty_target_s,
        action: ghostty_action_s
    ) -> Bool {
        switch target.tag {
        case GHOSTTY_TARGET_SURFACE:
            guard let surface = target.target.surface else { return false }
            guard let view = GhosttyTerminalView.from(surface: surface) else { return false }

            switch action.tag {
            case GHOSTTY_ACTION_SET_TITLE:
                if let cTitle = action.action.set_title.title {
                    let title = String(cString: cTitle)
                    DispatchQueue.main.async { view.title = title }
                }
                return true

            case GHOSTTY_ACTION_PWD:
                if let cPwd = action.action.pwd.pwd {
                    let pwd = String(cString: cPwd)
                    DispatchQueue.main.async { view.pwd = pwd }
                }
                return true

            case GHOSTTY_ACTION_CELL_SIZE:
                let size = action.action.cell_size
                DispatchQueue.main.async {
                    view.cellSize = NSSize(width: Double(size.width), height: Double(size.height))
                }
                return true

            case GHOSTTY_ACTION_RENDERER_HEALTH:
                let healthy = action.action.renderer_health == GHOSTTY_RENDERER_HEALTH_OK
                DispatchQueue.main.async { view.isHealthy = healthy }
                return true

            case GHOSTTY_ACTION_MOUSE_SHAPE:
                let shape = action.action.mouse_shape
                DispatchQueue.main.async { view.setCursorShape(shape) }
                return true

            case GHOSTTY_ACTION_MOUSE_VISIBILITY:
                let visibility = action.action.mouse_visibility
                DispatchQueue.main.async { view.setCursorVisibility(visibility == GHOSTTY_MOUSE_VISIBLE) }
                return true

            case GHOSTTY_ACTION_RENDER:
                if Thread.isMainThread {
                    view.scheduleRender()
                } else {
                    DispatchQueue.main.async {
                        view.scheduleRender()
                    }
                }
                return true

            default:
                return false
            }

        case GHOSTTY_TARGET_APP:
            return false

        default:
            return false
        }
    }

    private static func readClipboard(
        _ userdata: UnsafeMutableRawPointer?,
        location: ghostty_clipboard_e,
        state: UnsafeMutableRawPointer?
    ) {
        guard let view = GhosttyTerminalView.from(userdata: userdata),
              let surface = view.surface else { return }

        let pasteboard = NSPasteboard.general
        let value = pasteboard.string(forType: .string) ?? ""
        value.withCString { ptr in
            ghostty_surface_complete_clipboard_request(surface, ptr, state, false)
        }
    }

    private static func confirmReadClipboard(
        _ userdata: UnsafeMutableRawPointer?,
        string: UnsafePointer<CChar>?,
        state: UnsafeMutableRawPointer?,
        request: ghostty_clipboard_request_e
    ) {
        guard let view = GhosttyTerminalView.from(userdata: userdata),
              let surface = view.surface else { return }
        let value = string.map { String(cString: $0) } ?? ""
        value.withCString { ptr in
            ghostty_surface_complete_clipboard_request(surface, ptr, state, true)
        }
    }

    private static func writeClipboard(
        _ userdata: UnsafeMutableRawPointer?,
        location: ghostty_clipboard_e,
        content: UnsafePointer<ghostty_clipboard_content_s>?,
        len: Int,
        confirm: Bool
    ) {
        guard let content, len > 0 else { return }
        let buffer = UnsafeBufferPointer(start: content, count: len)
        var text: String?
        for item in buffer {
            if let mime = item.mime, let data = item.data {
                let mimeStr = String(cString: mime)
                if mimeStr == "text/plain" || mimeStr == "text/plain;charset=utf-8" {
                    text = String(cString: data)
                    break
                }
            }
        }
        if text == nil, let first = buffer.first, let data = first.data {
            text = String(cString: data)
        }
        guard let text else { return }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
    }

    private static func closeSurface(_ userdata: UnsafeMutableRawPointer?, processAlive: Bool) {
        guard let view = GhosttyTerminalView.from(userdata: userdata) else { return }
        DispatchQueue.main.async {
            view.onClose?()
        }
    }
}
