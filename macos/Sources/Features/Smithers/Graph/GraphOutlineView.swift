import SwiftUI

/// Accessible list-based outline view of the graph
/// Provides a VoiceOver-friendly alternative to the canvas view
struct GraphOutlineView: View {
    @ObservedObject var graph: SessionGraph
    @Binding var selectedNodeId: UUID?

    var body: some View {
        ScrollViewReader { proxy in
            List(selection: $selectedNodeId) {
                ForEach(graph.orderedNodes, id: \.id) { node in
                    GraphOutlineRow(node: node, depth: depthForNode(node))
                        .tag(node.id)
                        .id(node.id)
                }
            }
            .listStyle(.sidebar)
            .onChange(of: selectedNodeId) { newValue in
                if let nodeId = newValue {
                    withAnimation {
                        proxy.scrollTo(nodeId, anchor: .center)
                    }
                }
            }
        }
        .accessibilityLabel("Session Graph Outline")
        .accessibilityHint("List view of session nodes in chronological order")
    }

    /// Calculate the depth/indentation level for a node based on its parent chain
    private func depthForNode(_ node: GraphNode) -> Int {
        var depth = 0
        var currentNode = node

        while let parentId = currentNode.parentId,
              let parent = graph.nodes[parentId] {
            depth += 1
            currentNode = parent
        }

        return depth
    }
}

/// A row in the graph outline list
struct GraphOutlineRow: View {
    let node: GraphNode
    let depth: Int

    private let indentWidth: CGFloat = 20

    var body: some View {
        HStack(spacing: 8) {
            // Indentation based on depth
            if depth > 0 {
                Spacer()
                    .frame(width: CGFloat(depth) * indentWidth)
            }

            // Node type indicator
            nodeTypeIcon
                .frame(width: 20, height: 20)

            // Node content
            VStack(alignment: .leading, spacing: 2) {
                Text(nodeLabel)
                    .font(.body)
                    .lineLimit(2)

                HStack(spacing: 8) {
                    Text(nodeTypeLabel)
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Text(formatTimestamp(node.timestamp))
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    // MARK: - Helpers

    private var nodeTypeIcon: some View {
        Group {
            switch node.type {
            case .message:
                let role = (node.data["role"]?.value as? String) ?? "assistant"
                Image(systemName: role == "user" ? "person.circle" : "sparkle")
                    .foregroundColor(.blue)
            case .toolUse:
                Image(systemName: "wrench.and.screwdriver")
                    .foregroundColor(.purple)
            case .toolResult:
                Image(systemName: "checkmark.circle")
                    .foregroundColor(.green)
            case .checkpoint:
                Image(systemName: "bookmark.circle")
                    .foregroundColor(.orange)
            case .subagentRun:
                Image(systemName: "person.2.circle")
                    .foregroundColor(.pink)
            case .skillRun:
                Image(systemName: "bolt.circle")
                    .foregroundColor(.cyan)
            case .promptRebase:
                Image(systemName: "arrow.triangle.branch")
                    .foregroundColor(.yellow)
            case .browserSnapshot:
                Image(systemName: "globe")
                    .foregroundColor(.indigo)
            }
        }
    }

    private var nodeLabel: String {
        switch node.type {
        case .message:
            let role = (node.data["role"]?.value as? String) ?? "assistant"
            let preview = node.text?.prefix(80) ?? ""
            return "\(role == "user" ? "User" : "Assistant"): \(preview)"
        case .toolUse:
            return node.toolName ?? "Tool"
        case .toolResult:
            let success = (node.data["success"]?.value as? Bool) ?? true
            return success ? "Tool succeeded" : "Tool failed"
        case .checkpoint:
            let label = (node.data["label"]?.value as? String) ?? "Checkpoint"
            return label
        case .subagentRun:
            return "Subagent run"
        case .skillRun:
            let skillName = (node.data["skill_name"]?.value as? String) ?? "Skill"
            return "Skill: \(skillName)"
        case .promptRebase:
            return "Prompt rebase"
        case .browserSnapshot:
            let url = (node.data["url"]?.value as? String) ?? "Browser snapshot"
            return url
        }
    }

    private var nodeTypeLabel: String {
        switch node.type {
        case .message:
            return "Message"
        case .toolUse:
            return "Tool Use"
        case .toolResult:
            return "Tool Result"
        case .checkpoint:
            return "Checkpoint"
        case .subagentRun:
            return "Subagent"
        case .skillRun:
            return "Skill"
        case .promptRebase:
            return "Rebase"
        case .browserSnapshot:
            return "Browser"
        }
    }

    private var accessibilityLabel: String {
        let depthInfo = depth > 0 ? "Depth \(depth), " : ""
        return "\(depthInfo)\(nodeTypeLabel): \(nodeLabel)"
    }

    private func formatTimestamp(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: - Preview

#Preview("Graph Outline") {
    @State var selectedNodeId: UUID?
    let graph = SessionGraph()

    // Add mock nodes
    let root = GraphNode(
        id: UUID(),
        type: .message,
        parentId: nil,
        timestamp: Date().addingTimeInterval(-300),
        data: ["role": AnyCodable("user"), "text": AnyCodable("Can you help me analyze this code?")]
    )
    graph.addNode(root)

    let response1 = GraphNode(
        id: UUID(),
        type: .message,
        parentId: root.id,
        timestamp: Date().addingTimeInterval(-290),
        data: ["role": AnyCodable("assistant"), "text": AnyCodable("Of course! Let me read the file first.")]
    )
    graph.addNode(response1)

    let toolUse = GraphNode(
        id: UUID(),
        type: .toolUse,
        parentId: response1.id,
        timestamp: Date().addingTimeInterval(-280),
        data: ["tool_name": AnyCodable("read_file")]
    )
    graph.addNode(toolUse)

    let toolResult = GraphNode(
        id: UUID(),
        type: .toolResult,
        parentId: toolUse.id,
        timestamp: Date().addingTimeInterval(-270),
        data: ["success": AnyCodable(true), "output": AnyCodable("File contents...")]
    )
    graph.addNode(toolResult)

    let checkpoint = GraphNode(
        id: UUID(),
        type: .checkpoint,
        parentId: response1.id,
        timestamp: Date().addingTimeInterval(-260),
        data: ["label": AnyCodable("Before refactoring")]
    )
    graph.addNode(checkpoint)

    let response2 = GraphNode(
        id: UUID(),
        type: .message,
        parentId: checkpoint.id,
        timestamp: Date().addingTimeInterval(-250),
        data: ["role": AnyCodable("assistant"), "text": AnyCodable("I can see the code has some issues. Let me suggest improvements...")]
    )
    graph.addNode(response2)

    return GraphOutlineView(graph: graph, selectedNodeId: $selectedNodeId)
        .frame(width: 400, height: 600)
}
