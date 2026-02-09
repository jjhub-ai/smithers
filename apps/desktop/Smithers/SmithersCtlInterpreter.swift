import Foundation

@MainActor
final class SmithersCtlInterpreter {
    struct SmithersCtlResult {
        let output: String
        let exitCode: Int

        static func ok(_ output: String = "") -> SmithersCtlResult {
            SmithersCtlResult(output: output, exitCode: 0)
        }

        static func error(_ message: String) -> SmithersCtlResult {
            SmithersCtlResult(output: message, exitCode: 1)
        }
    }

    private weak var workspace: WorkspaceState?

    init(workspace: WorkspaceState) {
        self.workspace = workspace
    }

    func dispatch(commandLine: String, cwd: String?) async -> SmithersCtlResult {
        let tokens = Self.tokenize(commandLine)
        guard !tokens.isEmpty else {
            return .error("smithers-ctl: missing command")
        }

        var index = 0
        if tokens[index] == "smithers-ctl" || tokens[index] == "smithers" {
            index += 1
        }
        guard index < tokens.count else {
            return .error("smithers-ctl: missing command")
        }

        let command = tokens[index]
        let args = Array(tokens.dropFirst(index + 1))
        switch command {
        case "open", "open-file":
            return handleOpen(args: args, cwd: cwd)
        case "terminal":
            return handleTerminal(args: args, cwd: cwd)
        case "diff":
            return handleDiff(args: args)
        case "overlay":
            return handleOverlay(args: args)
        case "dismiss-overlay":
            return handleDismissOverlay(args: args)
        case "webview":
            return await handleWebview(args: args)
        case "help", "--help", "-h":
            return .ok(Self.helpText)
        default:
            return .error("smithers-ctl: unknown command '\(command)'")
        }
    }

    private func handleOpen(args: [String], cwd: String?) -> SmithersCtlResult {
        guard let workspace else { return .error("smithers-ctl: no workspace") }
        var path: String?
        var line: Int?
        var column: Int?
        var index = 0
        while index < args.count {
            let arg = args[index]
            if arg == "--line", index + 1 < args.count {
                line = Int(args[index + 1])
                index += 2
                continue
            }
            if arg == "--column", index + 1 < args.count {
                column = Int(args[index + 1])
                index += 2
                continue
            }
            if arg.hasPrefix("+") {
                let spec = arg.dropFirst()
                let parts = spec.split(separator: ":", omittingEmptySubsequences: false)
                if let parsedLine = Int(parts.first ?? "") {
                    line = parsedLine
                }
                if parts.count > 1, let parsedColumn = Int(parts[1]) {
                    column = parsedColumn
                }
                index += 1
                continue
            }
            if arg.hasPrefix("--") {
                return .error("smithers-ctl open: unknown option \(arg)")
            }
            if path == nil {
                path = arg
            }
            index += 1
        }

        guard let path else {
            return .error("smithers-ctl open: missing <path>")
        }

        guard let url = resolvePath(path, cwd: cwd, allowDirectory: false) else {
            return .error("smithers-ctl open: file not found: \(path)")
        }

        if let line {
            let safeLine = max(1, line)
            let safeColumn = max(1, column ?? 1)
            workspace.openFileAtLocation(url, line: safeLine, column: safeColumn)
        } else {
            workspace.selectFile(url)
        }
        return .ok("opened \(workspace.displayPath(for: url))")
    }

    private func handleTerminal(args: [String], cwd: String?) -> SmithersCtlResult {
        guard let workspace else { return .error("smithers-ctl: no workspace") }
        var command: String?
        var workingDirectory: String?
        var commandParts: [String] = []
        var index = 0
        while index < args.count {
            let arg = args[index]
            if arg == "run", command == nil, commandParts.isEmpty {
                index += 1
                continue
            }
            if arg == "--command", index + 1 < args.count {
                command = args[index + 1]
                index += 2
                continue
            }
            if arg == "--cwd", index + 1 < args.count {
                workingDirectory = args[index + 1]
                index += 2
                continue
            }
            if arg.hasPrefix("--") {
                return .error("smithers-ctl terminal: unknown option \(arg)")
            }
            commandParts.append(arg)
            index += 1
        }

        if command == nil, !commandParts.isEmpty {
            command = commandParts.joined(separator: " ")
        }

        let resolvedCwd: String?
        if let workingDirectory {
            guard let cwdURL = resolvePath(workingDirectory, cwd: cwd, allowDirectory: true) else {
                return .error("smithers-ctl terminal: invalid --cwd \(workingDirectory)")
            }
            resolvedCwd = cwdURL.path
        } else {
            resolvedCwd = nil
        }

        let terminalURL = workspace.openTerminal(command: command, cwd: resolvedCwd)
        return .ok(terminalURL.absoluteString)
    }

    private func handleDiff(args: [String]) -> SmithersCtlResult {
        guard let workspace else { return .error("smithers-ctl: no workspace") }
        var remaining = args
        if remaining.first == "show" {
            remaining.removeFirst()
        }

        var content: String?
        var title: String?
        var file: String?
        var index = 0
        while index < remaining.count {
            let arg = remaining[index]
            if arg == "--content", index + 1 < remaining.count {
                content = remaining[index + 1]
                index += 2
                continue
            }
            if arg == "--title", index + 1 < remaining.count {
                title = remaining[index + 1]
                index += 2
                continue
            }
            if arg == "--file", index + 1 < remaining.count {
                file = remaining[index + 1]
                index += 2
                continue
            }
            if arg.hasPrefix("--") {
                return .error("smithers-ctl diff: unknown option \(arg)")
            }
            if content == nil {
                content = arg
            }
            index += 1
        }

        guard let content else {
            return .error("smithers-ctl diff: missing --content")
        }

        let summary = DiffPreview.summarize(diff: content)
        let resolvedTitle: String
        if let title, !title.isEmpty {
            resolvedTitle = title
        } else if let file {
            resolvedTitle = URL(fileURLWithPath: file).lastPathComponent
        } else if summary.files.count == 1 {
            resolvedTitle = summary.files[0]
        } else {
            resolvedTitle = "Diff"
        }
        workspace.openDiffTab(title: resolvedTitle, summary: summary.summary, diff: content)
        return .ok("opened diff")
    }

    private func handleOverlay(args: [String]) -> SmithersCtlResult {
        guard let workspace else { return .error("smithers-ctl: no workspace") }
        var type: OverlayType = .chat
        var message: String?
        var title: String?
        var position: OverlayPosition = .bottom
        var duration: TimeInterval?
        var progress: Double?

        var index = 0
        while index < args.count {
            let arg = args[index]
            if arg == "--type", index + 1 < args.count {
                let value = args[index + 1].lowercased()
                type = OverlayType(rawValue: value) ?? .chat
                index += 2
                continue
            }
            if arg == "--message", index + 1 < args.count {
                message = args[index + 1]
                index += 2
                continue
            }
            if arg == "--title", index + 1 < args.count {
                title = args[index + 1]
                index += 2
                continue
            }
            if arg == "--position", index + 1 < args.count {
                let value = args[index + 1].lowercased()
                position = OverlayPosition(rawValue: value) ?? .bottom
                index += 2
                continue
            }
            if arg == "--duration", index + 1 < args.count {
                if let value = Double(args[index + 1]) {
                    duration = value > 0 ? value : nil
                }
                index += 2
                continue
            }
            if arg == "--percent", index + 1 < args.count {
                if let value = Double(args[index + 1]) {
                    let normalized = value > 1 ? value / 100.0 : value
                    progress = min(max(normalized, 0), 1)
                }
                index += 2
                continue
            }
            if arg == "dismiss" {
                workspace.dismissOverlay(id: nil)
                return .ok("dismissed overlay")
            }
            if arg.hasPrefix("--") {
                return .error("smithers-ctl overlay: unknown option \(arg)")
            }
            if message == nil {
                message = arg
            }
            index += 1
        }

        guard let message else {
            return .error("smithers-ctl overlay: missing --message")
        }

        let id = workspace.showOverlay(
            type: type,
            message: message,
            title: title,
            position: position,
            duration: duration,
            progress: progress
        )
        return .ok(id)
    }

    private func handleDismissOverlay(args: [String]) -> SmithersCtlResult {
        guard let workspace else { return .error("smithers-ctl: no workspace") }
        var overlayId: String?
        if let first = args.first, !first.hasPrefix("--") {
            overlayId = first
        } else {
            var index = 0
            while index < args.count {
                if args[index] == "--id", index + 1 < args.count {
                    overlayId = args[index + 1]
                    break
                }
                index += 1
            }
        }
        workspace.dismissOverlay(id: overlayId)
        return .ok("dismissed overlay")
    }

    private func handleWebview(args: [String]) async -> SmithersCtlResult {
        guard workspace != nil else { return .error("smithers-ctl: no workspace") }
        guard !args.isEmpty else { return .error("smithers-ctl webview: missing subcommand") }

        let subcommand = args[0]
        let remaining = Array(args.dropFirst())
        switch subcommand {
        case "open":
            return handleWebviewOpen(args: remaining)
        case "close":
            return handleWebviewClose(args: remaining)
        case "eval":
            return await handleWebviewEval(args: remaining)
        case "url":
            return handleWebviewURL(args: remaining)
        default:
            if subcommand.hasPrefix("http://") || subcommand.hasPrefix("https://") {
                return handleWebviewOpen(args: args)
            }
            return .error("smithers-ctl webview: unknown subcommand \(subcommand)")
        }
    }

    private func handleWebviewOpen(args: [String]) -> SmithersCtlResult {
        guard let workspace else { return .error("smithers-ctl: no workspace") }
        guard let urlString = args.first else {
            return .error("smithers-ctl webview open: missing <url>")
        }
        var title: String?
        var index = 1
        while index < args.count {
            if args[index] == "--title", index + 1 < args.count {
                title = args[index + 1]
                index += 2
                continue
            }
            index += 1
        }
        guard let url = URL(string: urlString) else {
            return .error("smithers-ctl webview open: invalid url")
        }
        let tabId = workspace.openWebview(url: url, title: title)
        return .ok(tabId.absoluteString)
    }

    private func handleWebviewClose(args: [String]) -> SmithersCtlResult {
        guard let workspace else { return .error("smithers-ctl: no workspace") }
        guard let idString = args.first, let id = URL(string: idString) else {
            return .error("smithers-ctl webview close: missing <tab-id>")
        }
        workspace.closeFile(id)
        return .ok("closed webview")
    }

    private func handleWebviewEval(args: [String]) async -> SmithersCtlResult {
        guard let workspace else { return .error("smithers-ctl: no workspace") }
        guard let idString = args.first, let id = URL(string: idString) else {
            return .error("smithers-ctl webview eval: missing <tab-id>")
        }
        var script: String?
        var index = 1
        while index < args.count {
            if args[index] == "--js", index + 1 < args.count {
                script = args[index + 1]
                break
            }
            index += 1
        }
        guard let script else {
            return .error("smithers-ctl webview eval: missing --js")
        }
        let result = await workspace.evaluateWebviewJavaScript(script, tabId: id)
        switch result {
        case .success(let value):
            return .ok(value)
        case .failure(let error):
            return .error(error.localizedDescription)
        }
    }

    private func handleWebviewURL(args: [String]) -> SmithersCtlResult {
        guard let workspace else { return .error("smithers-ctl: no workspace") }
        guard let idString = args.first, let id = URL(string: idString) else {
            return .error("smithers-ctl webview url: missing <tab-id>")
        }
        guard let url = workspace.currentWebviewURL(tabId: id) else {
            return .error("smithers-ctl webview url: unknown tab")
        }
        return .ok(url.absoluteString)
    }

    private func resolvePath(_ path: String, cwd: String?, allowDirectory: Bool) -> URL? {
        let expanded = (path as NSString).expandingTildeInPath
        let fm = FileManager.default
        let baseURL: URL?
        if let cwd, !cwd.isEmpty {
            baseURL = URL(fileURLWithPath: cwd)
        } else {
            baseURL = workspace?.rootDirectory
        }

        let candidate: URL
        if expanded.hasPrefix("/") {
            candidate = URL(fileURLWithPath: expanded)
        } else if let baseURL {
            candidate = URL(fileURLWithPath: expanded, relativeTo: baseURL)
        } else {
            return nil
        }

        let normalized = candidate.standardizedFileURL
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: normalized.path, isDirectory: &isDir) else { return nil }
        if isDir.boolValue && !allowDirectory {
            return nil
        }
        return normalized
    }

    private static func tokenize(_ input: String) -> [String] {
        var tokens: [String] = []
        var current = ""
        var quote: Character?
        var escape = false

        for ch in input {
            if escape {
                current.append(ch)
                escape = false
                continue
            }
            if ch == "\\" {
                escape = true
                continue
            }
            if let activeQuote = quote {
                if ch == activeQuote {
                    quote = nil
                } else {
                    current.append(ch)
                }
                continue
            }
            if ch == "\"" || ch == "'" {
                quote = ch
                continue
            }
            if ch.isWhitespace {
                if !current.isEmpty {
                    tokens.append(current)
                    current = ""
                }
                continue
            }
            current.append(ch)
        }
        if !current.isEmpty {
            tokens.append(current)
        }
        return tokens
    }

    private static let helpText = """
smithers-ctl: control the Smithers IDE

Commands:
  open|open-file <path> [--line N] [--column N] [+N[:C]]
  terminal [--command CMD] [--cwd PATH] | terminal run <cmd>
  diff show --content <diff> [--title TITLE] [--file PATH]
  overlay --type <chat|progress|panel> --message <text> [--title TITLE] [--position <bottom|center|top>] [--duration N] [--percent N]
  dismiss-overlay [--id ID]
  webview open <url> [--title TITLE]
  webview close <tab-id>
  webview eval <tab-id> --js <script>
  webview url <tab-id>
"""
}
