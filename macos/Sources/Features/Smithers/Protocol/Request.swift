import Foundation

/// A request to send to agentd
struct AgentRequest: Encodable {
    let id: String
    let method: String
    let params: [String: AnyCodable]

    init(method: String, params: [String: Any] = [:]) {
        self.id = UUID().uuidString
        self.method = method
        self.params = params.mapValues { AnyCodable($0) }
    }

    /// Create a session
    static func createSession(workspaceRoot: String) -> AgentRequest {
        AgentRequest(method: "session.create", params: ["workspace_root": workspaceRoot])
    }

    /// Send a message to a session
    static func sendMessage(sessionId: String, message: String, surfaces: [[String: Any]] = []) -> AgentRequest {
        AgentRequest(method: "session.send", params: [
            "session_id": sessionId,
            "message": message,
            "surfaces": surfaces,
        ])
    }

    /// Cancel a run
    static func cancelRun(runId: String) -> AgentRequest {
        AgentRequest(method: "run.cancel", params: ["run_id": runId])
    }
}
