import SwiftUI
import GhosttyKit

/// Inspector tab types
enum InspectorTab: String, CaseIterable, Identifiable {
    case stack = "Stack"
    case diff = "Diff"
    case todos = "Todos"
    case browser = "Browser"
    case tools = "Tools"
    case runDetails = "Run Details"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .stack: return "square.stack.3d.up"
        case .diff: return "doc.text.magnifyingglass"
        case .todos: return "checklist"
        case .browser: return "safari"
        case .tools: return "wrench.and.screwdriver"
        case .runDetails: return "info.circle"
        }
    }
}

/// Right inspector panel with tabs for various tools and views
struct SessionInspectorView: View {
    @Binding var selectedTab: InspectorTab
    @Binding var selectedNodeId: UUID?
    var terminalManager: TerminalSessionManager?
    var workingDirectory: URL?
    var onOpenDrawer: (() -> Void)?
    @EnvironmentObject var ghostty: Ghostty.App

    var body: some View {
        VStack(spacing: 0) {
            // Tab picker
            tabPicker

            Divider()

            // Tab content
            tabContent
        }
        .frame(minWidth: 320, maxWidth: 420)
        .background(Color(nsColor: .controlBackgroundColor))
    }

    // MARK: - Subviews

    private var tabPicker: some View {
        Picker("Inspector Tab", selection: $selectedTab) {
            ForEach(InspectorTab.allCases) { tab in
                Label(tab.rawValue, systemImage: tab.icon)
                    .tag(tab)
            }
        }
        .pickerStyle(.segmented)
        .padding(8)
    }

    @ViewBuilder
    private var tabContent: some View {
        switch selectedTab {
        case .stack:
            StackView(selectedNodeId: $selectedNodeId)
        case .diff:
            DiffView(selectedNodeId: $selectedNodeId)
        case .todos:
            TodosView()
        case .browser:
            BrowserView()
        case .tools:
            ToolsView(
                selectedNodeId: $selectedNodeId,
                terminalManager: terminalManager,
                workingDirectory: workingDirectory,
                onOpenDrawer: onOpenDrawer
            )
            .environmentObject(ghostty)
        case .runDetails:
            RunDetailsView(selectedNodeId: $selectedNodeId)
        }
    }
}

// MARK: - Tab Views (Placeholders)

/// Stack view showing JJ commit stack
struct StackView: View {
    @Binding var selectedNodeId: UUID?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Stack")
                    .font(.headline)
                    .padding()

                Text("JJ commit stack will be displayed here")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .padding(.horizontal)

                Spacer()
            }
        }
    }
}

/// Diff viewer for comparing changes
struct DiffView: View {
    @Binding var selectedNodeId: UUID?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Diff")
                    .font(.headline)
                    .padding()

                Text("File diffs will be displayed here")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .padding(.horizontal)

                Spacer()
            }
        }
    }
}

/// Todos panel for managing tasks
struct TodosView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Todos")
                        .font(.headline)

                    Spacer()

                    Button(action: addTodo) {
                        Image(systemName: "plus.circle.fill")
                    }
                    .buttonStyle(.plain)
                    .foregroundColor(.accentColor)
                }
                .padding()

                Text("Todo list will be displayed here")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .padding(.horizontal)

                Spacer()
            }
        }
    }

    private func addTodo() {
        // TODO: Implement add todo
        print("Add todo")
    }
}

/// Browser tab for web snapshots and forms
struct BrowserView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Browser")
                    .font(.headline)
                    .padding()

                Text("Browser snapshots and forms will be displayed here")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .padding(.horizontal)

                Spacer()
            }
        }
    }
}

/// Tools view showing tool invocations and details
struct ToolsView: View {
    @Binding var selectedNodeId: UUID?
    var terminalManager: TerminalSessionManager?
    var workingDirectory: URL?
    var onOpenDrawer: (() -> Void)?
    @EnvironmentObject var ghostty: Ghostty.App

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // Header
                HStack {
                    Text("Tools")
                        .font(.headline)
                    Spacer()
                }
                .padding()

                Divider()

                if let nodeId = selectedNodeId,
                   let node = MockDataService.shared.getNode(id: nodeId) {
                    toolDetailsView(for: node)
                } else {
                    emptyStateView
                }
            }
        }
    }

    @ViewBuilder
    private func toolDetailsView(for node: GraphNode) -> some View {
        switch node.type {
        case .toolUse:
            toolUseDetails(for: node)
        case .toolResult:
            toolResultDetails(for: node)
        default:
            VStack(alignment: .leading, spacing: 12) {
                Text("Not a tool node")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .padding()
                Spacer()
            }
        }
    }

    private func toolUseDetails(for node: GraphNode) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            // Tool name with icon
            HStack(spacing: 12) {
                Image(systemName: toolIcon(for: node.toolName))
                    .font(.system(size: 32))
                    .foregroundColor(.accentColor)

                VStack(alignment: .leading, spacing: 4) {
                    Text(node.toolName ?? "Unknown Tool")
                        .font(.title2)
                        .fontWeight(.semibold)

                    Text("Tool Invocation")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()

                // Open Terminal button
                if shouldShowTerminalButton(for: node) {
                    Button(action: {
                        openTerminalHere()
                    }) {
                        HStack(spacing: 4) {
                            Image(systemName: "terminal")
                            Text("Terminal")
                        }
                        .font(.caption)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }

                // Copy all input button
                if let input = node.data["input"]?.value as? [String: Any] {
                    Button(action: {
                        copyInputParameters(input)
                    }) {
                        HStack(spacing: 4) {
                            Image(systemName: "doc.on.doc")
                            Text("Copy")
                        }
                        .font(.caption)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }
            .padding()

            Divider()

            // Status badge
            HStack {
                statusBadge(for: node)
                Spacer()
            }
            .padding(.horizontal)

            // Tool input parameters
            if let input = node.data["input"]?.value as? [String: Any], !input.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Input Parameters")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundColor(.secondary)

                    ForEach(Array(input.keys.sorted()), id: \.self) { key in
                        if let value = input[key] {
                            copyableParameterRow(key: key, value: "\(value)")
                        }
                    }
                }
                .padding()
                .background(Color(nsColor: .textBackgroundColor).opacity(0.5))
                .cornerRadius(8)
                .padding(.horizontal)
            }

            // Metadata
            VStack(alignment: .leading, spacing: 8) {
                Text("Metadata")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(.secondary)

                CopyableDetailRow(label: "Node ID", value: node.id.uuidString)
                DetailRow(label: "Timestamp", value: formatTimestamp(node.timestamp))

                if let duration = node.data["duration"]?.value as? Double {
                    DetailRow(label: "Duration", value: String(format: "%.3fs", duration))
                }
            }
            .padding()

            Spacer()
        }
    }

    private func toolResultDetails(for node: GraphNode) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            // Header
            HStack(spacing: 12) {
                Image(systemName: "doc.text")
                    .font(.system(size: 32))
                    .foregroundColor(.green)

                VStack(alignment: .leading, spacing: 4) {
                    Text("Tool Result")
                        .font(.title2)
                        .fontWeight(.semibold)

                    if let toolName = node.data["tool_name"]?.value as? String {
                        Text(toolName)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
            .padding()

            Divider()

            // Output preview with copy button
            if let output = node.data["output"]?.value as? String {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Output")
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundColor(.secondary)

                        Spacer()

                        Button(action: {
                            copyToClipboard(output)
                        }) {
                            HStack(spacing: 4) {
                                Image(systemName: "doc.on.doc")
                                Text("Copy")
                            }
                            .font(.caption)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }

                    ScrollView {
                        Text(output)
                            .font(.system(size: 12, design: .monospaced))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                    }
                    .frame(maxHeight: 300)
                    .padding(8)
                    .background(Color(nsColor: .textBackgroundColor))
                    .cornerRadius(8)
                }
                .padding(.horizontal)
            }

            // Artifact reference
            if let artifactRef = node.artifactRef {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Artifact")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundColor(.secondary)

                    HStack {
                        Image(systemName: "doc.on.doc")
                        Text(artifactRef)
                            .font(.system(size: 11, design: .monospaced))
                        Spacer()
                        Button(action: {
                            copyToClipboard(artifactRef)
                        }) {
                            Image(systemName: "doc.on.doc")
                        }
                        .buttonStyle(.plain)
                        .controlSize(.small)
                        .help("Copy artifact reference")

                        Button(action: {}) {
                            Text("Open")
                                .font(.caption)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                    .padding()
                    .background(Color(nsColor: .textBackgroundColor).opacity(0.5))
                    .cornerRadius(8)
                }
                .padding(.horizontal)
            }

            // Metadata
            VStack(alignment: .leading, spacing: 8) {
                Text("Metadata")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(.secondary)

                CopyableDetailRow(label: "Node ID", value: node.id.uuidString)
                DetailRow(label: "Timestamp", value: formatTimestamp(node.timestamp))

                if let byteCount = node.data["byte_count"]?.value as? Int {
                    DetailRow(label: "Size", value: formatBytes(byteCount))
                }
            }
            .padding()

            Spacer()
        }
    }

    private var emptyStateView: some View {
        VStack(spacing: 16) {
            Image(systemName: "wrench.and.screwdriver")
                .font(.system(size: 48))
                .foregroundColor(.secondary.opacity(0.5))

            Text("No tool selected")
                .font(.headline)
                .foregroundColor(.secondary)

            Text("Select a tool invocation from the graph or chat to see details")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 200)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    // MARK: - Helper Views

    private func parameterRow(key: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(key)
                .font(.caption)
                .foregroundColor(.secondary)
            Text(value)
                .font(.system(size: 12, design: .monospaced))
                .textSelection(.enabled)
        }
    }

    private func statusBadge(for node: GraphNode) -> some View {
        let status = node.data["status"]?.value as? String ?? "completed"
        let color: Color = {
            switch status {
            case "running": return .blue
            case "completed": return .green
            case "error": return .red
            default: return .gray
            }
        }()

        return HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text(status.capitalized)
                .font(.caption)
                .fontWeight(.medium)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(color.opacity(0.15))
        .cornerRadius(12)
    }

    // MARK: - Helper Functions

    private func toolIcon(for toolName: String?) -> String {
        switch toolName {
        case "Read": return "doc.text"
        case "Edit": return "pencil"
        case "Write": return "doc.badge.plus"
        case "Bash": return "terminal"
        case "Glob": return "doc.text.magnifyingglass"
        case "Grep": return "text.magnifyingglass"
        default: return "wrench.and.screwdriver"
        }
    }

    private func formatTimestamp(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: date)
    }

    private func formatBytes(_ bytes: Int) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(bytes))
    }

    // MARK: - Clipboard Functions

    private func copyToClipboard(_ text: String) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
    }

    private func copyInputParameters(_ input: [String: Any]) {
        let formatted = input.map { key, value in
            "\(key): \(value)"
        }.joined(separator: "\n")
        copyToClipboard(formatted)
    }

    // MARK: - Enhanced Parameter View

    private func copyableParameterRow(key: String, value: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 4) {
                Text(key)
                    .font(.caption)
                    .foregroundColor(.secondary)
                Text(value)
                    .font(.system(size: 12, design: .monospaced))
                    .textSelection(.enabled)
            }

            Spacer()

            Button(action: {
                copyToClipboard(value)
            }) {
                Image(systemName: "doc.on.doc")
                    .font(.caption)
            }
            .buttonStyle(.plain)
            .foregroundColor(.secondary)
            .help("Copy value")
        }
    }

    // MARK: - Terminal Integration

    private func shouldShowTerminalButton(for node: GraphNode) -> Bool {
        // Show terminal button if we have terminal manager and working directory
        guard terminalManager != nil, onOpenDrawer != nil, workingDirectory != nil else { return false }
        // Show for tool invocations (especially Bash, but useful for all tools)
        return node.type == .toolUse
    }

    private func openTerminalHere() {
        guard let terminalManager = terminalManager,
              let workingDirectory = workingDirectory,
              let onOpenDrawer = onOpenDrawer else { return }

        // Open the drawer
        onOpenDrawer()

        // Reuse or open a new terminal tab at the working directory
        let tabId = terminalManager.reuseOrOpenTab(
            cwd: workingDirectory,
            title: "Terminal"
        )

        // Create the surface if needed
        if let tab = terminalManager.selectedTab, tab.surfaceView == nil {
            terminalManager.createSurface(for: tabId, ghosttyApp: ghostty)
        }
    }
}

// MARK: - Mock Data Service

class MockDataService {
    static let shared = MockDataService()

    private var nodes: [UUID: GraphNode] = [:]

    func registerNode(_ node: GraphNode) {
        nodes[node.id] = node
    }

    func getNode(id: UUID) -> GraphNode? {
        nodes[id]
    }

    func reset() {
        nodes.removeAll()
    }
}

/// Run details view showing execution metadata
struct RunDetailsView: View {
    @Binding var selectedNodeId: UUID?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // Header
                HStack {
                    Text("Run Details")
                        .font(.headline)
                    Spacer()
                }
                .padding()

                Divider()

                if let nodeId = selectedNodeId,
                   let node = MockDataService.shared.getNode(id: nodeId) {
                    nodeDetailsView(for: node)
                } else {
                    emptyStateView
                }
            }
        }
    }

    @ViewBuilder
    private func nodeDetailsView(for node: GraphNode) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            // Node type badge
            HStack(spacing: 12) {
                Image(systemName: nodeTypeIcon(for: node.type))
                    .font(.system(size: 32))
                    .foregroundColor(nodeTypeColor(for: node.type))

                VStack(alignment: .leading, spacing: 4) {
                    Text(nodeTypeLabel(for: node.type))
                        .font(.title2)
                        .fontWeight(.semibold)

                    Text("Node Details")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()

                // Status indicator if available
                if let status = node.data["status"]?.value as? String {
                    statusBadge(for: status)
                }
            }
            .padding()

            Divider()

            // Core Metadata Section
            VStack(alignment: .leading, spacing: 8) {
                Text("Core Metadata")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(.secondary)

                CopyableDetailRow(label: "Node ID", value: node.id.uuidString)
                DetailRow(label: "Type", value: node.type.rawValue.capitalized)
                DetailRow(label: "Timestamp", value: formatFullTimestamp(node.timestamp))

                if let parentId = node.parentId {
                    CopyableDetailRow(label: "Parent ID", value: parentId.uuidString)
                }
            }
            .padding()
            .background(Color(nsColor: .textBackgroundColor).opacity(0.5))
            .cornerRadius(8)
            .padding(.horizontal)

            // Execution Metadata Section
            if hasExecutionMetadata(node) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Execution Metrics")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundColor(.secondary)

                    if let duration = node.data["duration"]?.value as? Double {
                        DetailRow(label: "Duration", value: formatDuration(duration))
                    }

                    if let inputTokens = node.data["input_tokens"]?.value as? Int {
                        DetailRow(label: "Input Tokens", value: formatNumber(inputTokens))
                    }

                    if let outputTokens = node.data["output_tokens"]?.value as? Int {
                        DetailRow(label: "Output Tokens", value: formatNumber(outputTokens))
                    }

                    if let totalTokens = node.data["total_tokens"]?.value as? Int {
                        DetailRow(label: "Total Tokens", value: formatNumber(totalTokens))
                    }

                    if let cost = node.data["cost"]?.value as? Double {
                        DetailRow(label: "Cost", value: String(format: "$%.4f", cost))
                    }
                }
                .padding()
                .background(Color(nsColor: .textBackgroundColor).opacity(0.5))
                .cornerRadius(8)
                .padding(.horizontal)
            }

            // Type-Specific Metadata Section
            typeSpecificMetadata(for: node)

            // Additional Data Section (any extra fields)
            if hasAdditionalData(node) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Additional Data")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundColor(.secondary)

                    ForEach(sortedAdditionalKeys(for: node), id: \.self) { key in
                        if let value = node.data[key]?.value {
                            CopyableDetailRow(label: key, value: "\(value)")
                        }
                    }
                }
                .padding()
                .background(Color(nsColor: .textBackgroundColor).opacity(0.5))
                .cornerRadius(8)
                .padding(.horizontal)
            }

            Spacer()
        }
    }

    @ViewBuilder
    private func typeSpecificMetadata(for node: GraphNode) -> some View {
        switch node.type {
        case .message:
            if let role = node.data["role"]?.value as? String {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Message Details")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundColor(.secondary)

                    DetailRow(label: "Role", value: role.capitalized)

                    if let isStreaming = node.data["is_streaming"]?.value as? Bool {
                        DetailRow(label: "Streaming", value: isStreaming ? "Yes" : "No")
                    }

                    if let contentLength = node.text?.count {
                        DetailRow(label: "Content Length", value: "\(contentLength) characters")
                    }
                }
                .padding()
                .background(Color(nsColor: .textBackgroundColor).opacity(0.5))
                .cornerRadius(8)
                .padding(.horizontal)
            }

        case .toolUse, .toolResult:
            if let toolName = node.toolName {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Tool Details")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundColor(.secondary)

                    DetailRow(label: "Tool Name", value: toolName)

                    if node.type == .toolResult {
                        if let byteCount = node.data["byte_count"]?.value as? Int {
                            DetailRow(label: "Output Size", value: formatBytes(byteCount))
                        }

                        if let lineCount = node.data["line_count"]?.value as? Int {
                            DetailRow(label: "Output Lines", value: formatNumber(lineCount))
                        }

                        if let artifactRef = node.artifactRef {
                            CopyableDetailRow(label: "Artifact Ref", value: artifactRef)
                        }
                    }
                }
                .padding()
                .background(Color(nsColor: .textBackgroundColor).opacity(0.5))
                .cornerRadius(8)
                .padding(.horizontal)
            }

        case .checkpoint:
            VStack(alignment: .leading, spacing: 8) {
                Text("Checkpoint Details")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(.secondary)

                if let checkpointId = node.data["checkpoint_id"]?.value as? String {
                    CopyableDetailRow(label: "Checkpoint ID", value: checkpointId)
                }

                if let label = node.data["label"]?.value as? String {
                    DetailRow(label: "Label", value: label)
                }

                if let jjCommitId = node.data["jj_commit_id"]?.value as? String {
                    CopyableDetailRow(label: "JJ Commit ID", value: jjCommitId)
                }

                if let bookmarkName = node.data["bookmark_name"]?.value as? String {
                    DetailRow(label: "Bookmark", value: bookmarkName)
                }
            }
            .padding()
            .background(Color(nsColor: .textBackgroundColor).opacity(0.5))
            .cornerRadius(8)
            .padding(.horizontal)

        case .skillRun:
            if let skillId = node.data["skill_id"]?.value as? String {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Skill Details")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundColor(.secondary)

                    DetailRow(label: "Skill ID", value: skillId)

                    if let skillName = node.data["skill_name"]?.value as? String {
                        DetailRow(label: "Skill Name", value: skillName)
                    }
                }
                .padding()
                .background(Color(nsColor: .textBackgroundColor).opacity(0.5))
                .cornerRadius(8)
                .padding(.horizontal)
            }

        default:
            EmptyView()
        }
    }

    private var emptyStateView: some View {
        VStack(spacing: 16) {
            Image(systemName: "info.circle")
                .font(.system(size: 48))
                .foregroundColor(.secondary.opacity(0.5))

            Text("No node selected")
                .font(.headline)
                .foregroundColor(.secondary)

            Text("Select a node from the graph or chat to see execution details")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 200)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    // MARK: - Helper Functions

    private func nodeTypeIcon(for type: GraphNodeType) -> String {
        switch type {
        case .message: return "bubble.left.and.bubble.right"
        case .toolUse: return "wrench.and.screwdriver"
        case .toolResult: return "doc.text"
        case .checkpoint: return "bookmark.fill"
        case .subagentRun: return "arrow.triangle.branch"
        case .skillRun: return "command"
        case .promptRebase: return "arrow.triangle.merge"
        case .browserSnapshot: return "safari"
        }
    }

    private func nodeTypeColor(for type: GraphNodeType) -> Color {
        switch type {
        case .message: return .blue
        case .toolUse: return .purple
        case .toolResult: return .green
        case .checkpoint: return .orange
        case .subagentRun: return .cyan
        case .skillRun: return .pink
        case .promptRebase: return .indigo
        case .browserSnapshot: return .teal
        }
    }

    private func nodeTypeLabel(for type: GraphNodeType) -> String {
        switch type {
        case .message: return "Message"
        case .toolUse: return "Tool Invocation"
        case .toolResult: return "Tool Result"
        case .checkpoint: return "Checkpoint"
        case .subagentRun: return "Subagent Run"
        case .skillRun: return "Skill Run"
        case .promptRebase: return "Prompt Rebase"
        case .browserSnapshot: return "Browser Snapshot"
        }
    }

    private func statusBadge(for status: String) -> some View {
        let color: Color = {
            switch status {
            case "running": return .blue
            case "completed", "success": return .green
            case "error", "failed": return .red
            case "pending": return .orange
            default: return .gray
            }
        }()

        return HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text(status.capitalized)
                .font(.caption)
                .fontWeight(.medium)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(color.opacity(0.15))
        .cornerRadius(12)
    }

    private func formatFullTimestamp(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
        return formatter.string(from: date)
    }

    private func formatDuration(_ seconds: Double) -> String {
        if seconds < 1.0 {
            return String(format: "%.0f ms", seconds * 1000)
        } else if seconds < 60.0 {
            return String(format: "%.2f s", seconds)
        } else {
            let minutes = Int(seconds / 60)
            let secs = seconds.truncatingRemainder(dividingBy: 60)
            return String(format: "%d min %.1f s", minutes, secs)
        }
    }

    private func formatNumber(_ number: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        return formatter.string(from: NSNumber(value: number)) ?? "\(number)"
    }

    private func formatBytes(_ bytes: Int) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(bytes))
    }

    private func hasExecutionMetadata(_ node: GraphNode) -> Bool {
        node.data["duration"] != nil ||
        node.data["input_tokens"] != nil ||
        node.data["output_tokens"] != nil ||
        node.data["total_tokens"] != nil ||
        node.data["cost"] != nil
    }

    private func hasAdditionalData(_ node: GraphNode) -> Bool {
        !sortedAdditionalKeys(for: node).isEmpty
    }

    private func sortedAdditionalKeys(for node: GraphNode) -> [String] {
        let knownKeys: Set<String> = [
            "text", "role", "is_streaming", "tool_name", "status", "input", "output",
            "duration", "input_tokens", "output_tokens", "total_tokens", "cost",
            "byte_count", "line_count", "artifact_ref", "checkpoint_id", "label",
            "jj_commit_id", "bookmark_name", "skill_id", "skill_name", "tool_use_id",
            "success"
        ]

        return node.data.keys
            .filter { !knownKeys.contains($0) }
            .sorted()
    }
}

/// Detail row for key-value pairs
struct DetailRow: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
            Text(value)
                .font(.body)
                .textSelection(.enabled)
        }
    }
}

/// Detail row with copy button
struct CopyableDetailRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 4) {
                Text(label)
                    .font(.caption)
                    .foregroundColor(.secondary)
                Text(value)
                    .font(.body)
                    .textSelection(.enabled)
            }

            Spacer()

            Button(action: {
                let pasteboard = NSPasteboard.general
                pasteboard.clearContents()
                pasteboard.setString(value, forType: .string)
            }) {
                Image(systemName: "doc.on.doc")
                    .font(.caption)
            }
            .buttonStyle(.plain)
            .foregroundColor(.secondary)
            .help("Copy \(label.lowercased())")
        }
    }
}

// MARK: - Preview

#Preview("Inspector - Stack") {
    SessionInspectorView(
        selectedTab: .constant(.stack),
        selectedNodeId: .constant(nil)
    )
    .frame(width: 350, height: 600)
}

#Preview("Inspector - Tools with Tool Use") {
    // Create a mock tool use node
    let toolUseNode = GraphNode(
        id: UUID(),
        type: .toolUse,
        parentId: nil,
        timestamp: Date(),
        data: [
            "tool_name": AnyCodable("Read"),
            "status": AnyCodable("completed"),
            "input": AnyCodable([
                "file_path": "/workspace/auth.py",
                "line_start": 1,
                "line_end": 100
            ] as [String: Any]),
            "duration": AnyCodable(0.42)
        ]
    )
    MockDataService.shared.registerNode(toolUseNode)

    return SessionInspectorView(
        selectedTab: .constant(.tools),
        selectedNodeId: .constant(toolUseNode.id)
    )
    .frame(width: 400, height: 600)
}

#Preview("Inspector - Tools with Tool Result") {
    // Create a mock tool result node
    let toolResultNode = GraphNode(
        id: UUID(),
        type: .toolResult,
        parentId: nil,
        timestamp: Date(),
        data: [
            "tool_name": AnyCodable("Bash"),
            "output": AnyCodable("============================= test session starts ==============================\ntests/test_auth.py::test_valid_token PASSED [ 33%]\ntests/test_auth.py::test_expired_token PASSED [ 66%]\ntests/test_auth.py::test_invalid_token PASSED [100%]\n\n============================== 3 passed in 0.12s ==============================="),
            "byte_count": AnyCodable(312),
            "artifact_ref": AnyCodable("artifact://bash-pytest-001")
        ]
    )
    MockDataService.shared.registerNode(toolResultNode)

    return SessionInspectorView(
        selectedTab: .constant(.tools),
        selectedNodeId: .constant(toolResultNode.id)
    )
    .frame(width: 400, height: 600)
}

#Preview("Inspector - Tools Empty") {
    SessionInspectorView(
        selectedTab: .constant(.tools),
        selectedNodeId: .constant(nil)
    )
    .frame(width: 350, height: 600)
}

#Preview("Inspector - Run Details with Message") {
    // Create a mock message node with execution metadata
    let messageNode = GraphNode(
        id: UUID(),
        type: .message,
        parentId: nil,
        timestamp: Date(),
        data: [
            "role": AnyCodable("assistant"),
            "text": AnyCodable("I'll help you debug the authentication issue. Let me start by reading the auth.py file."),
            "is_streaming": AnyCodable(false),
            "input_tokens": AnyCodable(1234),
            "output_tokens": AnyCodable(567),
            "total_tokens": AnyCodable(1801),
            "cost": AnyCodable(0.0125),
            "duration": AnyCodable(2.345)
        ]
    )
    MockDataService.shared.registerNode(messageNode)

    return SessionInspectorView(
        selectedTab: .constant(.runDetails),
        selectedNodeId: .constant(messageNode.id)
    )
    .frame(width: 400, height: 700)
}

#Preview("Inspector - Run Details with Checkpoint") {
    // Create a mock checkpoint node
    let checkpointNode = GraphNode(
        id: UUID(),
        type: .checkpoint,
        parentId: UUID(),
        timestamp: Date(),
        data: [
            "checkpoint_id": AnyCodable("checkpoint-abc123"),
            "label": AnyCodable("Before authentication refactor"),
            "jj_commit_id": AnyCodable("qpvuntsm"),
            "bookmark_name": AnyCodable("auth-checkpoint-1"),
            "status": AnyCodable("completed"),
            "duration": AnyCodable(0.523)
        ]
    )
    MockDataService.shared.registerNode(checkpointNode)

    return SessionInspectorView(
        selectedTab: .constant(.runDetails),
        selectedNodeId: .constant(checkpointNode.id)
    )
    .frame(width: 400, height: 700)
}

#Preview("Inspector - Run Details Empty") {
    SessionInspectorView(
        selectedTab: .constant(.runDetails),
        selectedNodeId: .constant(nil)
    )
    .frame(width: 350, height: 600)
}
