import Foundation
import Combine

/// Client for communicating with agentd
@MainActor
class AgentClient: ObservableObject {
    @Published var isConnected = false
    @Published var lastError: String?

    private var process: Process?
    private var inputPipe: Pipe?
    private var outputPipe: Pipe?
    private var cancellables = Set<AnyCancellable>()

    private let eventSubject = PassthroughSubject<AgentEvent, Never>()
    var events: AnyPublisher<AgentEvent, Never> {
        eventSubject.eraseToAnyPublisher()
    }

    private let workspaceRoot: String
    private let sandboxMode: String
    private let agentBackend: String

    init(
        workspaceRoot: String,
        sandboxMode: String = "host",
        agentBackend: String = "fake"
    ) {
        self.workspaceRoot = workspaceRoot
        self.sandboxMode = sandboxMode
        self.agentBackend = agentBackend
    }

    func start() async throws {
        // Find Python and agentd
        let pythonPath = "/usr/bin/env"
        let agentdModule = "agentd"

        process = Process()
        process?.executableURL = URL(fileURLWithPath: pythonPath)
        process?.arguments = [
            "python", "-m", agentdModule,
            "--workspace", workspaceRoot,
            "--sandbox", sandboxMode,
            "--backend", agentBackend,
        ]

        inputPipe = Pipe()
        outputPipe = Pipe()
        process?.standardInput = inputPipe
        process?.standardOutput = outputPipe
        process?.standardError = FileHandle.nullDevice

        // Handle process termination
        process?.terminationHandler = { [weak self] proc in
            Task { @MainActor in
                self?.isConnected = false
                if proc.terminationStatus != 0 {
                    self?.lastError = "agentd exited with code \(proc.terminationStatus)"
                }
            }
        }

        // Read output in background
        Task.detached { [weak self] in
            await self?.readOutput()
        }

        try process?.run()
        isConnected = true
    }

    func stop() {
        process?.terminate()
        process = nil
        isConnected = false
    }

    func send(_ request: AgentRequest) throws {
        guard let pipe = inputPipe else {
            throw AgentClientError.notConnected
        }

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(request)
        let line = String(data: data, encoding: .utf8)! + "\n"

        pipe.fileHandleForWriting.write(line.data(using: .utf8)!)
    }

    private func readOutput() async {
        guard let pipe = outputPipe else { return }

        let handle = pipe.fileHandleForReading
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        while true {
            guard let data = try? handle.availableData, !data.isEmpty else {
                break
            }

            let lines = String(data: data, encoding: .utf8)?
                .split(separator: "\n")
                .map(String.init) ?? []

            for line in lines where !line.isEmpty {
                if let lineData = line.data(using: .utf8),
                   let event = try? decoder.decode(AgentEvent.self, from: lineData) {
                    await MainActor.run {
                        eventSubject.send(event)
                    }
                }
            }
        }
    }
}

enum AgentClientError: Error {
    case notConnected
    case encodingError
}
