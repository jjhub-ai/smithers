import SwiftUI

struct AgentDashboardView: View {
    @ObservedObject var workspace: WorkspaceState

    var body: some View {
        let theme = workspace.theme
        VStack(spacing: 0) {
            dashboardHeader(theme: theme)
            Divider().background(theme.dividerColor)

            ScrollView {
                VStack(spacing: 0) {
                    agentsSection(theme: theme)
                    Divider().background(theme.dividerColor)
                    mergeQueueSection(theme: theme)
                }
            }
        }
        .background(theme.secondaryBackgroundColor)
    }

    // MARK: - Header

    private func dashboardHeader(theme: AppTheme) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "person.3.fill")
                .font(.system(size: Typography.base, weight: .semibold))
                .foregroundStyle(theme.foregroundColor)
            Text("Agents")
                .font(.system(size: Typography.base, weight: .semibold))
                .foregroundStyle(theme.foregroundColor)
            Spacer()
            Button {
                workspace.showNewAgentPrompt()
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "plus")
                    Text("New Agent")
                }
                .font(.system(size: Typography.s, weight: .medium))
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    // MARK: - Agents Section

    @ViewBuilder
    private func agentsSection(theme: AppTheme) -> some View {
        if let orchestrator = workspace.agentOrchestrator {
            if orchestrator.activeAgents.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "person.badge.plus")
                        .font(.system(size: 24))
                        .foregroundStyle(theme.mutedForegroundColor)
                    Text("No active agents")
                        .font(.system(size: Typography.s))
                        .foregroundStyle(theme.mutedForegroundColor)
                    Text("Spawn agents to work on tasks in parallel")
                        .font(.system(size: Typography.xs))
                        .foregroundStyle(theme.mutedForegroundColor)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
            } else {
                ForEach(orchestrator.activeAgents) { agent in
                    AgentRow(agent: agent, workspace: workspace, theme: theme)
                    Divider().background(theme.dividerColor)
                }
            }
        }
    }

    // MARK: - Merge Queue Section

    @ViewBuilder
    private func mergeQueueSection(theme: AppTheme) -> some View {
        if let orchestrator = workspace.agentOrchestrator {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("MERGE QUEUE")
                        .font(.system(size: Typography.s, weight: .semibold))
                        .foregroundStyle(theme.mutedForegroundColor)
                        .textCase(.uppercase)
                    Spacer()

                    if !orchestrator.isProcessingQueue {
                        Button {
                            orchestrator.processQueue()
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "play.fill")
                                Text("Run")
                            }
                            .font(.system(size: Typography.xs, weight: .medium))
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.mini)
                    } else {
                        HStack(spacing: 4) {
                            ProgressView()
                                .controlSize(.mini)
                            Text("Processing...")
                                .font(.system(size: Typography.xs))
                                .foregroundStyle(theme.mutedForegroundColor)
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)

                let queueEntries = orchestrator.mergeQueue.entries.filter {
                    $0.status == .waiting || $0.status == .merging || $0.status == .testing
                }

                if queueEntries.isEmpty {
                    Text("Queue empty")
                        .font(.system(size: Typography.s))
                        .foregroundStyle(theme.mutedForegroundColor)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                } else {
                    ForEach(Array(queueEntries.enumerated()), id: \.element.id) { index, entry in
                        MergeQueueRow(
                            entry: entry,
                            position: index + 1,
                            theme: theme,
                            onMoveUp: {
                                orchestrator.mergeQueue.reprioritize(
                                    agentId: entry.agentId,
                                    priority: MergeQueuePriority(rawValue: entry.priority.rawValue + 1) ?? .urgent
                                )
                            },
                            onMoveDown: {
                                orchestrator.mergeQueue.reprioritize(
                                    agentId: entry.agentId,
                                    priority: MergeQueuePriority(rawValue: max(0, entry.priority.rawValue - 1)) ?? .low
                                )
                            },
                            onRemove: {
                                orchestrator.mergeQueue.remove(agentId: entry.agentId)
                            }
                        )
                    }
                }

                // Queue settings
                VStack(alignment: .leading, spacing: 4) {
                    Divider().background(theme.dividerColor)

                    HStack {
                        Text("Test command:")
                            .font(.system(size: Typography.xs))
                            .foregroundStyle(theme.mutedForegroundColor)
                        Text(workspace.vcsPreferences.mergeQueueTestCommand ?? "none")
                            .font(.system(size: Typography.xs, design: .monospaced))
                            .foregroundStyle(theme.foregroundColor)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 4)

                    HStack(spacing: 12) {
                        HStack(spacing: 4) {
                            Text("Auto-resolve:")
                                .font(.system(size: Typography.xs))
                                .foregroundStyle(theme.mutedForegroundColor)
                            Text(workspace.vcsPreferences.mergeQueueAutoResolveConflicts ? "ON" : "OFF")
                                .font(.system(size: Typography.xs, weight: .medium))
                                .foregroundStyle(workspace.vcsPreferences.mergeQueueAutoResolveConflicts ? .green : .red)
                        }
                        HStack(spacing: 4) {
                            Text("Speculative:")
                                .font(.system(size: Typography.xs))
                                .foregroundStyle(theme.mutedForegroundColor)
                            Text(workspace.vcsPreferences.mergeQueueSpeculativeMerging ? "ON" : "OFF")
                                .font(.system(size: Typography.xs, weight: .medium))
                                .foregroundStyle(workspace.vcsPreferences.mergeQueueSpeculativeMerging ? .green : theme.mutedForegroundColor)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 4)
                }
            }
        }
    }
}

// MARK: - Agent Row

private struct AgentRow: View {
    let agent: AgentWorkspace
    let workspace: WorkspaceState
    let theme: AppTheme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                statusIndicator
                Text(agent.id)
                    .font(.system(size: Typography.s, weight: .semibold))
                    .foregroundStyle(theme.foregroundColor)
                Text("(\(agent.status.displayName))")
                    .font(.system(size: Typography.xs))
                    .foregroundStyle(statusColor)
                Spacer()
                Text(formatElapsed(agent.elapsedTime))
                    .font(.system(size: Typography.xs, design: .monospaced))
                    .foregroundStyle(theme.mutedForegroundColor)
            }

            Text(agent.task)
                .font(.system(size: Typography.s))
                .foregroundStyle(theme.mutedForegroundColor)
                .lineLimit(2)

            if !agent.filesChanged.isEmpty {
                HStack(spacing: 4) {
                    Image(systemName: "doc")
                        .font(.system(size: Typography.xs))
                    Text("\(agent.filesChanged.count) file(s) changed")
                        .font(.system(size: Typography.xs))
                }
                .foregroundStyle(theme.mutedForegroundColor)
            }

            HStack(spacing: 8) {
                Button("View Chat") {
                    workspace.switchToAgentChat(agent)
                }
                .buttonStyle(.bordered)
                .controlSize(.mini)

                Button("View Diff") {
                    Task { await workspace.viewAgentDiff(agent) }
                }
                .buttonStyle(.bordered)
                .controlSize(.mini)

                if agent.status == .running {
                    Button("Cancel", role: .destructive) {
                        Task { try? await workspace.agentOrchestrator?.cancelAgent(agent) }
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                }

                if agent.status == .merged {
                    Button("View Commit") {
                        // Navigate to change in JJ panel
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private var statusIndicator: some View {
        switch agent.status {
        case .running:
            ProgressView()
                .controlSize(.mini)
        default:
            Image(systemName: agent.status.icon)
                .font(.system(size: Typography.s))
                .foregroundStyle(statusColor)
        }
    }

    private var statusColor: Color {
        switch agent.status {
        case .running: return .blue
        case .completed, .inQueue: return .orange
        case .merged: return .green
        case .failed, .conflicted: return .red
        case .cancelled: return .gray
        case .merging: return .purple
        }
    }

    private func formatElapsed(_ interval: TimeInterval) -> String {
        let minutes = Int(interval) / 60
        let seconds = Int(interval) % 60
        return String(format: "%dm %02ds", minutes, seconds)
    }
}

// MARK: - Merge Queue Row

private struct MergeQueueRow: View {
    let entry: MergeQueueEntry
    let position: Int
    let theme: AppTheme
    let onMoveUp: () -> Void
    let onMoveDown: () -> Void
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Text("#\(position)")
                .font(.system(size: Typography.s, weight: .bold, design: .monospaced))
                .foregroundStyle(theme.mutedForegroundColor)
                .frame(width: 24)

            Text(entry.agentId)
                .font(.system(size: Typography.s))
                .foregroundStyle(theme.foregroundColor)
                .lineLimit(1)

            Spacer()

            Text(entry.status.rawValue)
                .font(.system(size: Typography.xs))
                .foregroundStyle(statusColor(for: entry.status))

            Text(entry.priority == .normal ? "" : entry.priority.displayName)
                .font(.system(size: Typography.xs))
                .foregroundStyle(theme.mutedForegroundColor)

            HStack(spacing: 2) {
                Button(action: onMoveUp) {
                    Image(systemName: "chevron.up")
                        .font(.system(size: Typography.xs))
                }
                .buttonStyle(.plain)

                Button(action: onMoveDown) {
                    Image(systemName: "chevron.down")
                        .font(.system(size: Typography.xs))
                }
                .buttonStyle(.plain)

                Button(action: onRemove) {
                    Image(systemName: "xmark")
                        .font(.system(size: Typography.xs))
                }
                .buttonStyle(.plain)
            }
            .foregroundStyle(theme.mutedForegroundColor)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
    }

    private func statusColor(for status: MergeQueueStatus) -> Color {
        switch status {
        case .waiting: return .orange
        case .merging, .testing: return .blue
        case .passed, .landed: return .green
        case .conflicted, .testFailed: return .red
        case .cancelled: return .gray
        }
    }
}

// MARK: - Priority Display

extension MergeQueuePriority {
    var displayName: String {
        switch self {
        case .low: return "low"
        case .normal: return "normal"
        case .high: return "high"
        case .urgent: return "urgent"
        }
    }
}
