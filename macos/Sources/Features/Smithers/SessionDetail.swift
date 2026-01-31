import SwiftUI

/// The main content area showing the selected session's terminal
struct SessionDetail: View {
    let session: Session?

    var body: some View {
        if let session = session {
            VStack(spacing: 0) {
                // Header
                sessionHeader(session)

                Divider()

                // Terminal area (placeholder for now)
                terminalPlaceholder(session)

                // Input bar at bottom
                inputBar
            }
        } else {
            emptyState
        }
    }

    // MARK: - Subviews

    private func sessionHeader(_ session: Session) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(session.title)
                    .font(.headline)

                HStack(spacing: 4) {
                    Circle()
                        .fill(session.isActive ? Color.green : Color.secondary)
                        .frame(width: 6, height: 6)
                    Text(session.isActive ? "Running" : "Idle")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()

            // Action buttons
            HStack(spacing: 12) {
                Button(action: {}) {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.plain)
                .help("Restart session")

                Button(action: {}) {
                    Image(systemName: "square.and.arrow.up")
                }
                .buttonStyle(.plain)
                .help("Share session")

                Button(action: {}) {
                    Image(systemName: "trash")
                }
                .buttonStyle(.plain)
                .foregroundColor(.red.opacity(0.8))
                .help("Delete session")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color(nsColor: .controlBackgroundColor))
    }

    private func terminalPlaceholder(_ session: Session) -> some View {
        // This is where SurfaceView will go
        // For now, showing a placeholder that looks like a terminal
        ZStack {
            Color(nsColor: .textBackgroundColor)

            VStack(alignment: .leading, spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        terminalLine("$ claude", isCommand: true)
                        terminalLine("> What would you like to do?", isPrompt: true)
                        terminalLine("> \(session.title)", isInput: true)
                        terminalLine("")
                        terminalLine("I'll help you with that. Let me look at the codebase...")
                        terminalLine("")
                        terminalLine("[Reading files...]", isDim: true)
                        terminalLine("")
                        terminalLine("I found the relevant code. Here's what I see:")
                        terminalLine("")

                        // Simulated code block
                        Group {
                            terminalLine("```typescript", isDim: true)
                            terminalLine("  function authenticate(token: string) {")
                            terminalLine("    // TODO: Fix validation")
                            terminalLine("    return true;")
                            terminalLine("  }")
                            terminalLine("```", isDim: true)
                        }

                        terminalLine("")
                        terminalLine("The issue is on line 3...")
                        terminalLine("")
                        terminalLine("$ _", isCursor: true)
                    }
                    .padding(16)
                }

                Spacer()
            }
            .font(.system(size: 13, design: .monospaced))
            .foregroundColor(Color(nsColor: .textColor))
        }
    }

    private func terminalLine(_ text: String, isCommand: Bool = false, isPrompt: Bool = false, isInput: Bool = false, isDim: Bool = false, isCursor: Bool = false) -> some View {
        HStack(spacing: 0) {
            if isCursor {
                Text(text.dropLast())
                Rectangle()
                    .fill(Color.green)
                    .frame(width: 8, height: 16)
                    .opacity(0.8)
            } else {
                Text(text)
                    .foregroundColor(
                        isCommand ? .green :
                        isPrompt ? .blue :
                        isInput ? .purple :
                        isDim ? .secondary :
                        .primary
                    )
            }
            Spacer()
        }
    }

    private var inputBar: some View {
        HStack(spacing: 12) {
            Image(systemName: "terminal")
                .foregroundColor(.secondary)

            TextField("Type a message or command...", text: .constant(""))
                .textFieldStyle(.plain)

            Button(action: {}) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 24))
            }
            .buttonStyle(.plain)
            .foregroundColor(.accentColor)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color(nsColor: .controlBackgroundColor))
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 48))
                .foregroundColor(.secondary)

            Text("No session selected")
                .font(.headline)
                .foregroundColor(.secondary)

            Text("Select a session from the sidebar or create a new one")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .textBackgroundColor))
    }
}

#Preview("With Session") {
    SessionDetail(session: Session.mockSessions.first)
        .frame(width: 600, height: 500)
}

#Preview("Empty State") {
    SessionDetail(session: nil)
        .frame(width: 600, height: 500)
}
