import Foundation
import Network
import Darwin

struct CLIItem {
    let path: String
    let line: Int?
    let column: Int?
}

enum IPCClientError: Error {
    case connectionFailed(String)
    case connectionTimedOut
    case sendFailed(String)
    case sendTimedOut
    case receiveFailed(String)
    case receiveTimedOut
}

func printUsage() {
    let usage = """
    Usage: smithers [options] [+line[:column]] <file|dir>...

    Options:
      -w, --wait   Wait for files to close before exiting.
      -h, --help   Show this help text.
    """
    print(usage)
}

func exitWithUsage(_ message: String? = nil) -> Never {
    if let message {
        fputs("smithers: \(message)\n", stderr)
    }
    printUsage()
    exit(64)
}

func parseLineSpec(_ arg: String) -> (Int, Int?)? {
    guard arg.hasPrefix("+") else { return nil }
    let spec = String(arg.dropFirst())
    guard !spec.isEmpty else { return nil }

    var linePart = spec
    var columnPart: String? = nil
    if let index = spec.firstIndex(of: ":") {
        linePart = String(spec[..<index])
        columnPart = String(spec[spec.index(after: index)...])
    } else if let index = spec.firstIndex(of: ",") {
        linePart = String(spec[..<index])
        columnPart = String(spec[spec.index(after: index)...])
    }

    guard let lineValue = Int(linePart), lineValue > 0 else { return nil }
    var columnValue: Int? = nil
    if let columnPart, !columnPart.isEmpty {
        guard let parsed = Int(columnPart), parsed > 0 else { return nil }
        columnValue = parsed
    }
    return (lineValue, columnValue)
}

func resolvePath(_ path: String) -> String {
    let expanded = (path as NSString).expandingTildeInPath
    if expanded.hasPrefix("/") {
        return URL(fileURLWithPath: expanded).standardizedFileURL.path
    }
    let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    return URL(fileURLWithPath: expanded, relativeTo: cwd).standardizedFileURL.path
}

func makeOpenURL(for item: SmithersIPCOpenItem) -> URL? {
    var components = URLComponents()
    components.scheme = "smithers"
    components.host = "open"
    var queryItems = [URLQueryItem(name: "path", value: item.path)]
    if let line = item.line {
        queryItems.append(URLQueryItem(name: "line", value: String(line)))
    }
    if let column = item.column {
        queryItems.append(URLQueryItem(name: "column", value: String(column)))
    }
    components.queryItems = queryItems
    return components.url
}

func launchViaOpen(items: [SmithersIPCOpenItem]) {
    for item in items {
        guard let url = makeOpenURL(for: item) else { continue }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = [url.absoluteString]
        try? process.run()
        process.waitUntilExit()
    }
}

func sendIPCRequest(
    _ request: SmithersIPCRequest,
    waitForResponse: Bool,
    connectTimeout: TimeInterval,
    responseTimeout: TimeInterval?
) throws -> SmithersIPCResponse {
    let endpoint = NWEndpoint.unix(path: SmithersIPC.socketPath)
    let connection = NWConnection(to: endpoint, using: .tcp)
    let queue = DispatchQueue(label: "com.smithers.cli.ipc")

    let stateSemaphore = DispatchSemaphore(value: 0)
    var ready = false
    var stateError: NWError?

    connection.stateUpdateHandler = { state in
        switch state {
        case .ready:
            ready = true
            stateSemaphore.signal()
        case .failed(let error):
            stateError = error
            stateSemaphore.signal()
        case .cancelled:
            stateSemaphore.signal()
        default:
            break
        }
    }

    connection.start(queue: queue)

    if stateSemaphore.wait(timeout: .now() + connectTimeout) == .timedOut {
        connection.cancel()
        throw IPCClientError.connectionTimedOut
    }

    guard ready else {
        connection.cancel()
        throw IPCClientError.connectionFailed(stateError?.localizedDescription ?? "Not ready")
    }

    var payload = try JSONEncoder().encode(request)
    payload.append(0x0A)

    let sendSemaphore = DispatchSemaphore(value: 0)
    var sendError: NWError?
    connection.send(content: payload, completion: .contentProcessed { error in
        sendError = error
        sendSemaphore.signal()
    })

    if sendSemaphore.wait(timeout: .now() + 5) == .timedOut {
        connection.cancel()
        throw IPCClientError.sendTimedOut
    }

    if let sendError {
        connection.cancel()
        throw IPCClientError.sendFailed(sendError.localizedDescription)
    }

    let response = try receiveIPCResponse(connection: connection, timeout: responseTimeout, wait: waitForResponse)
    connection.cancel()
    return response
}

func receiveIPCResponse(
    connection: NWConnection,
    timeout: TimeInterval?,
    wait: Bool
) throws -> SmithersIPCResponse {
    let semaphore = DispatchSemaphore(value: 0)
    var buffer = Data()
    var responseData: Data?
    var receiveError: NWError?

    func receiveNext() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { data, _, isComplete, error in
            if let data {
                buffer.append(data)
            }
            if let newlineIndex = buffer.firstIndex(of: 0x0A) {
                responseData = Data(buffer.prefix(upTo: newlineIndex))
                semaphore.signal()
                return
            }
            if isComplete || error != nil {
                receiveError = error
                if !buffer.isEmpty {
                    responseData = buffer
                }
                semaphore.signal()
                return
            }
            receiveNext()
        }
    }

    receiveNext()

    if wait {
        semaphore.wait()
    } else if let timeout, semaphore.wait(timeout: .now() + timeout) == .timedOut {
        throw IPCClientError.receiveTimedOut
    }

    guard let responseData else {
        throw IPCClientError.receiveFailed(receiveError?.localizedDescription ?? "No response")
    }

    return try JSONDecoder().decode(SmithersIPCResponse.self, from: responseData)
}

let args = Array(CommandLine.arguments.dropFirst())

var waitFlag = false
var pendingLine: Int?
var pendingColumn: Int?
var rawItems: [CLIItem] = []
var parsingOptions = true

var index = 0
while index < args.count {
    let arg = args[index]
    if parsingOptions && arg == "--" {
        parsingOptions = false
        index += 1
        continue
    }
    if parsingOptions && (arg == "-h" || arg == "--help") {
        printUsage()
        exit(0)
    }
    if parsingOptions && (arg == "-w" || arg == "--wait") {
        waitFlag = true
        index += 1
        continue
    }
    if parsingOptions && arg.hasPrefix("+") {
        guard let (line, column) = parseLineSpec(arg) else {
            exitWithUsage("Invalid line spec: \(arg)")
        }
        pendingLine = line
        pendingColumn = column
        index += 1
        continue
    }

    let resolvedPath = resolvePath(arg)
    rawItems.append(CLIItem(path: resolvedPath, line: pendingLine, column: pendingColumn))
    pendingLine = nil
    pendingColumn = nil
    index += 1
}

if pendingLine != nil {
    exitWithUsage("Line spec must precede a path.")
}

if rawItems.isEmpty {
    printUsage()
    exit(64)
}

var hadMissingPaths = false
var items: [SmithersIPCOpenItem] = []
items.reserveCapacity(rawItems.count)

for item in rawItems {
    var isDir: ObjCBool = false
    let exists = FileManager.default.fileExists(atPath: item.path, isDirectory: &isDir)
    if !exists {
        fputs("smithers: path not found: \(item.path)\n", stderr)
        hadMissingPaths = true
        continue
    }
    let isDirectory = isDir.boolValue
    let line = isDirectory ? nil : item.line
    let column = line == nil ? nil : item.column
    let wait = (!isDirectory && waitFlag) ? true : nil
    items.append(SmithersIPCOpenItem(path: item.path, line: line, column: column, wait: wait))
}

if items.isEmpty {
    exit(hadMissingPaths ? 1 : 64)
}

let request = SmithersIPCRequest(items: items)
let waitRequested = items.contains { $0.wait == true }

func handleResponse(_ response: SmithersIPCResponse) -> Int32 {
    if response.status == .error {
        if let message = response.message {
            fputs("smithers: \(message)\n", stderr)
        }
        return 1
    }
    return hadMissingPaths ? 1 : 0
}

let connectTimeout: TimeInterval = 1.0
let responseTimeout: TimeInterval? = waitRequested ? nil : 2.0

if let response = try? sendIPCRequest(
    request,
    waitForResponse: waitRequested,
    connectTimeout: connectTimeout,
    responseTimeout: responseTimeout
) {
    exit(handleResponse(response))
}

launchViaOpen(items: items)

if waitRequested {
    let deadline = Date().addingTimeInterval(10)
    var lastError: Error?
    while Date() < deadline {
        do {
            let response = try sendIPCRequest(
                request,
                waitForResponse: waitRequested,
                connectTimeout: 0.5,
                responseTimeout: nil
            )
            exit(handleResponse(response))
        } catch {
            lastError = error
            Thread.sleep(forTimeInterval: 0.2)
        }
    }
    let message = "Timed out waiting for Smithers IPC." + (lastError.map { " (\($0))" } ?? "")
    fputs("smithers: \(message)\n", stderr)
    exit(1)
}

exit(hadMissingPaths ? 1 : 0)
