import SwiftUI

/// Root view for the Smithers app - combines sidebar and session detail
struct SmithersView: View {
    @State private var sessions: [Session] = Session.mockSessions
    @State private var selectedSessionId: UUID? = Session.mockSessions.first?.id

    var body: some View {
        NavigationSplitView {
            SessionSidebar(
                sessions: $sessions,
                selectedSessionId: $selectedSessionId
            )
            .navigationSplitViewColumnWidth(min: 200, ideal: 250, max: 300)
        } detail: {
            SessionDetail(session: selectedSession)
        }
        .frame(minWidth: 800, minHeight: 500)
    }

    private var selectedSession: Session? {
        sessions.first { $0.id == selectedSessionId }
    }
}

#Preview {
    SmithersView()
        .frame(width: 1000, height: 600)
}
