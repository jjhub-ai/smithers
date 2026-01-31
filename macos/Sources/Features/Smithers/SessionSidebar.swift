import SwiftUI

/// The left sidebar showing all sessions grouped by date
struct SessionSidebar: View {
    @Binding var sessions: [Session]
    @Binding var selectedSessionId: UUID?

    var body: some View {
        VStack(spacing: 0) {
            // New Chat button
            newChatButton
                .padding(.horizontal, 12)
                .padding(.top, 12)
                .padding(.bottom, 8)

            Divider()
                .padding(.horizontal, 12)

            // Session list
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    ForEach(SessionGroup.allCases, id: \.self) { group in
                        let groupSessions = sessionsFor(group: group)
                        if !groupSessions.isEmpty {
                            sessionGroupView(group: group, sessions: groupSessions)
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 12)
            }

            Spacer()

            Divider()
                .padding(.horizontal, 12)

            // Settings button
            settingsButton
                .padding(12)
        }
        .frame(minWidth: 200, idealWidth: 250, maxWidth: 300)
        .background(Color(nsColor: .controlBackgroundColor))
    }

    // MARK: - Subviews

    private var newChatButton: some View {
        Button(action: { addNewSession() }) {
            HStack {
                Image(systemName: "plus")
                Text("New Chat")
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(Color.secondary.opacity(0.3), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private var settingsButton: some View {
        Button(action: { /* TODO: Open settings */ }) {
            HStack {
                Image(systemName: "gear")
                Text("Settings")
                Spacer()
            }
        }
        .buttonStyle(.plain)
        .foregroundColor(.secondary)
    }

    private func sessionGroupView(group: SessionGroup, sessions: [Session]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            // Group header
            Text(group.rawValue)
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.secondary)
                .padding(.leading, 4)
                .padding(.bottom, 2)

            // Sessions in group
            ForEach(sessions) { session in
                SessionRow(
                    session: session,
                    isSelected: session.id == selectedSessionId
                )
                .onTapGesture {
                    selectedSessionId = session.id
                }
            }
        }
    }

    // MARK: - Helpers

    private func sessionsFor(group: SessionGroup) -> [Session] {
        sessions.filter { SessionGroup.group(for: $0.createdAt) == group }
    }

    private func addNewSession() {
        let newSession = Session(title: "New Chat")
        sessions.insert(newSession, at: 0)
        selectedSessionId = newSession.id
    }
}

#Preview {
    SessionSidebar(
        sessions: .constant(Session.mockSessions),
        selectedSessionId: .constant(Session.mockSessions.first?.id)
    )
    .frame(height: 500)
}
