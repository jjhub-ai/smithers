import Foundation
import Combine

/// Manages sessions and orchestrates communication with agentd
@MainActor
class SessionManager: ObservableObject {
    @Published var sessions: [Session] = []
    @Published var error: String?

    private var agentClient: AgentClient?
    private var cancellables = Set<AnyCancellable>()
    private let workspaceRoot: String
    private let sandboxMode: String
    private let agentBackend: String

    /// The workspace root directory for this session manager
    var workspace: String {
        workspaceRoot
    }

    init(
        workspaceRoot: String,
        sandboxMode: String = "host",
        agentBackend: String = "fake"
    ) {
        self.workspaceRoot = workspaceRoot
        self.sandboxMode = sandboxMode
        self.agentBackend = agentBackend
    }

    /// Start the agent daemon and load existing sessions
    func start() async throws {
        let client = AgentClient(
            workspaceRoot: workspaceRoot,
            sandboxMode: sandboxMode,
            agentBackend: agentBackend
        )

        // Subscribe to events before starting
        client.events
            .sink { [weak self] event in
                Task { @MainActor in
                    self?.handleEvent(event)
                }
            }
            .store(in: &cancellables)

        try await client.start()
        self.agentClient = client

        // Request list of existing sessions
        try client.send(AgentRequest(
            method: "session.list",
            params: ["limit": 100]
        ))
    }

    /// Stop the agent daemon
    func stop() {
        agentClient?.stop()
        agentClient = nil
        cancellables.removeAll()
    }

    /// Create a new session
    func createSession() throws {
        guard let client = agentClient else {
            throw SessionManagerError.notConnected
        }

        try client.send(AgentRequest.createSession(workspaceRoot: workspaceRoot))
    }

    /// Send a message to a session
    func sendMessage(sessionId: UUID, message: String, surfaces: [String] = []) throws {
        guard let client = agentClient else {
            throw SessionManagerError.notConnected
        }

        try client.send(AgentRequest.sendMessage(
            sessionId: sessionId.uuidString,
            message: message,
            surfaces: surfaces.map { ["type": $0] }
        ))
    }

    /// Cancel a running agent
    func cancelRun(runId: String) throws {
        guard let client = agentClient else {
            throw SessionManagerError.notConnected
        }

        try client.send(AgentRequest.cancelRun(runId: runId))
    }

    /// Run a skill in a session
    func runSkill(sessionId: UUID, skillId: String, args: String? = nil) throws {
        guard let client = agentClient else {
            throw SessionManagerError.notConnected
        }

        try client.send(AgentRequest.runSkill(
            sessionId: sessionId.uuidString,
            skillId: skillId,
            args: args
        ))
    }

    /// Create a checkpoint
    func createCheckpoint(sessionId: UUID, message: String, sessionNodeId: String? = nil) throws {
        guard let client = agentClient else {
            throw SessionManagerError.notConnected
        }

        try client.send(AgentRequest.createCheckpoint(
            sessionId: sessionId.uuidString,
            message: message,
            sessionNodeId: sessionNodeId
        ))
    }

    /// Restore a checkpoint
    func restoreCheckpoint(sessionId: UUID, checkpointId: String) throws {
        guard let client = agentClient else {
            throw SessionManagerError.notConnected
        }

        try client.send(AgentRequest.restoreCheckpoint(
            sessionId: sessionId.uuidString,
            checkpointId: checkpointId
        ))
    }

    // MARK: - Event Handling

    private func handleEvent(_ event: AgentEvent) {
        switch event.type {
        case .daemonReady:
            // Daemon is ready, sessions will be loaded via session.list response
            print("Daemon ready: \(event.data)")

        case .sessionCreated:
            // New session created
            if let sessionIdStr = event.data["session_id"]?.value as? String,
               let sessionId = UUID(uuidString: sessionIdStr) {
                let session = Session(
                    id: sessionId,
                    title: "New Session",
                    createdAt: Date(),
                    isActive: false
                )
                sessions.append(session)
            }

        case .searchResults:
            // Handle session list response from search results
            // TODO: Implement proper session list handling
            break

        case .runFinished, .runCancelled:
            // Mark session as inactive
            if let sessionIdStr = event.data["session_id"]?.value as? String,
               let sessionId = UUID(uuidString: sessionIdStr),
               let index = sessions.firstIndex(where: { $0.id == sessionId }) {
                sessions[index].isActive = false
            }

        case .runStarted:
            // Mark session as active when run starts
            if let sessionIdStr = event.data["session_id"]?.value as? String,
               let sessionId = UUID(uuidString: sessionIdStr),
               let index = sessions.firstIndex(where: { $0.id == sessionId }) {
                sessions[index].isActive = true

                // If there's a user message in the run, add it to the graph
                if let content = event.data["message"]?.value as? String {
                    let node = GraphNode(
                        id: UUID(),
                        type: .message,
                        parentId: sessions[index].graph.lastNodeId(),
                        timestamp: Date(),
                        data: [
                            "role": AnyCodable("user"),
                            "text": AnyCodable(content)
                        ]
                    )
                    sessions[index].graph.addNode(node)
                }
            }

        case .assistantDelta:
            // Update or create streaming assistant message
            if let currentSessionIndex = currentActiveSessionIndex(),
               let text = event.data["text"]?.value as? String {
                updateStreamingMessage(sessionIndex: currentSessionIndex, deltaText: text)
            }

        case .assistantFinal:
            // Finalize assistant message
            if let currentSessionIndex = currentActiveSessionIndex() {
                finalizeStreamingMessage(sessionIndex: currentSessionIndex)
            }

        case .toolStart:
            // Add tool use node
            if let currentSessionIndex = currentActiveSessionIndex(),
               let toolName = event.data["tool_name"]?.value as? String,
               let toolIdStr = event.data["tool_id"]?.value as? String,
               let toolId = UUID(uuidString: toolIdStr) {
                let node = GraphNode(
                    id: toolId,
                    type: .toolUse,
                    parentId: sessions[currentSessionIndex].graph.lastNodeId(),
                    timestamp: Date(),
                    data: [
                        "tool_name": AnyCodable(toolName),
                        "status": AnyCodable("running"),
                        "input": event.data["input"] ?? AnyCodable(":")
                    ]
                )
                sessions[currentSessionIndex].graph.addNode(node)
            }

        case .toolEnd:
            // Add tool result node and update tool use status
            if let currentSessionIndex = currentActiveSessionIndex(),
               let toolIdStr = event.data["tool_id"]?.value as? String,
               let toolId = UUID(uuidString: toolIdStr),
               let status = event.data["status"]?.value as? String {

                // Update tool use node status
                if let toolUseNode = sessions[currentSessionIndex].graph.getNode(id: toolId) {
                    var updatedData = toolUseNode.data
                    updatedData["status"] = AnyCodable(status)
                    let updatedNode = GraphNode(
                        id: toolUseNode.id,
                        type: toolUseNode.type,
                        parentId: toolUseNode.parentId,
                        timestamp: toolUseNode.timestamp,
                        data: updatedData
                    )
                    sessions[currentSessionIndex].graph.updateNode(updatedNode)
                }

                // Add tool result node
                let success = status == "completed" || status == "success"
                let resultNode = GraphNode(
                    id: UUID(),
                    type: .toolResult,
                    parentId: toolId,
                    timestamp: Date(),
                    data: [
                        "tool_name": event.data["tool_name"] ?? AnyCodable(""),
                        "output": event.data["output"] ?? AnyCodable(""),
                        "byte_count": event.data["byte_count"] ?? AnyCodable(0),
                        "artifact_ref": event.data["artifact_ref"] ?? AnyCodable(""),
                        "success": AnyCodable(success)
                    ]
                )
                sessions[currentSessionIndex].graph.addNode(resultNode)
            }

        case .checkpointCreated:
            // Add checkpoint node
            if let currentSessionIndex = currentActiveSessionIndex(),
               let checkpointId = event.data["checkpoint_id"]?.value as? String,
               let label = event.data["label"]?.value as? String {
                let node = GraphNode(
                    id: UUID(uuidString: checkpointId) ?? UUID(),
                    type: .checkpoint,
                    parentId: sessions[currentSessionIndex].graph.lastNodeId(),
                    timestamp: Date(),
                    data: [
                        "label": AnyCodable(label),
                        "jj_commit_id": event.data["jj_commit_id"] ?? AnyCodable(""),
                        "bookmark_name": event.data["bookmark_name"] ?? AnyCodable("")
                    ]
                )
                sessions[currentSessionIndex].graph.addNode(node)
            }

        case .checkpointRestored:
            // TODO: Handle checkpoint restoration in graph
            break

        case .skillStart:
            // Add skill run node
            if let currentSessionIndex = currentActiveSessionIndex(),
               let skillId = event.data["skill_id"]?.value as? String,
               let name = event.data["name"]?.value as? String {
                let node = GraphNode(
                    id: UUID(),
                    type: .skillRun,
                    parentId: sessions[currentSessionIndex].graph.lastNodeId(),
                    timestamp: Date(),
                    data: [
                        "skill_id": AnyCodable(skillId),
                        "name": AnyCodable(name),
                        "args": event.data["args"] ?? AnyCodable(""),
                        "status": AnyCodable("running")
                    ]
                )
                sessions[currentSessionIndex].graph.addNode(node)
            }

        case .skillResult, .skillEnd:
            // TODO: Update skill run node with result/status
            break

        case .subagentStart:
            // Add subagent run node
            if let currentSessionIndex = currentActiveSessionIndex(),
               let subagentIdStr = event.data["subagent_id"]?.value as? String,
               let subagentId = UUID(uuidString: subagentIdStr),
               let subagentType = event.data["subagent_type"]?.value as? String {
                let node = GraphNode(
                    id: subagentId,
                    type: .subagentRun,
                    parentId: sessions[currentSessionIndex].graph.lastNodeId(),
                    timestamp: Date(),
                    data: [
                        "subagent_type": AnyCodable(subagentType),
                        "prompt": event.data["prompt"] ?? AnyCodable(""),
                        "status": AnyCodable("running")
                    ]
                )
                sessions[currentSessionIndex].graph.addNode(node)
            }

        case .subagentEnd:
            // TODO: Update subagent run node with status
            break

        case .error:
            // Display error
            if let message = event.data["message"]?.value as? String {
                error = message
            }

        default:
            print("Unhandled event type: \(event.type)")
        }
    }

    // MARK: - Helper Methods

    private func currentActiveSessionIndex() -> Int? {
        sessions.firstIndex(where: { $0.isActive })
    }

    private var streamingMessageId: UUID?
    private var streamingMessageText: String = ""

    private func updateStreamingMessage(sessionIndex: Int, deltaText: String) {
        streamingMessageText += deltaText

        if let messageId = streamingMessageId {
            // Update existing node
            if let node = sessions[sessionIndex].graph.getNode(id: messageId) {
                var updatedData = node.data
                updatedData["text"] = AnyCodable(streamingMessageText)
                updatedData["is_streaming"] = AnyCodable(true)
                let updatedNode = GraphNode(
                    id: node.id,
                    type: node.type,
                    parentId: node.parentId,
                    timestamp: node.timestamp,
                    data: updatedData
                )
                sessions[sessionIndex].graph.updateNode(updatedNode)
            }
        } else {
            // Create new node
            let nodeId = UUID()
            let node = GraphNode(
                id: nodeId,
                type: .message,
                parentId: sessions[sessionIndex].graph.lastNodeId(),
                timestamp: Date(),
                data: [
                    "role": AnyCodable("assistant"),
                    "text": AnyCodable(streamingMessageText),
                    "is_streaming": AnyCodable(true)
                ]
            )
            sessions[sessionIndex].graph.addNode(node)
            streamingMessageId = nodeId
        }
    }

    private func finalizeStreamingMessage(sessionIndex: Int) {
        // Update the streaming message to mark it as complete
        if let messageId = streamingMessageId,
           let node = sessions[sessionIndex].graph.getNode(id: messageId) {
            var updatedData = node.data
            updatedData["is_streaming"] = AnyCodable(false)
            let updatedNode = GraphNode(
                id: node.id,
                type: node.type,
                parentId: node.parentId,
                timestamp: node.timestamp,
                data: updatedData
            )
            sessions[sessionIndex].graph.updateNode(updatedNode)
        }

        // Clear streaming state
        streamingMessageId = nil
        streamingMessageText = ""
    }
}

enum SessionManagerError: Error {
    case notConnected
}
