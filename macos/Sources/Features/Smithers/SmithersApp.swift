import SwiftUI

// MARK: - Xcode Preview for SmithersView

/// Full-window preview of the Smithers UI
/// Open this file in Xcode and use the Canvas preview (Cmd+Option+Enter)
#Preview("Smithers App") {
    SmithersView()
        .frame(width: 1000, height: 700)
}

#Preview("Sidebar Only") {
    SessionSidebar(
        sessions: .constant(Session.mockSessions),
        selectedSessionId: .constant(Session.mockSessions.first?.id)
    )
    .frame(width: 250, height: 600)
}

#Preview("Detail - With Session") {
    SessionDetail(session: Session.mockSessions.first)
        .frame(width: 700, height: 500)
}

#Preview("Detail - Empty") {
    SessionDetail(session: nil)
        .frame(width: 700, height: 500)
}
