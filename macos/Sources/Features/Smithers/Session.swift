import Foundation
import SwiftUI

/// A single Claude Code session (chat)
struct Session: Identifiable {
    let id: UUID
    var title: String
    var createdAt: Date
    var isActive: Bool

    init(id: UUID = UUID(), title: String, createdAt: Date = Date(), isActive: Bool = false) {
        self.id = id
        self.title = title
        self.createdAt = createdAt
        self.isActive = isActive
    }
}

/// Groups sessions by time period (Today, Yesterday, Last Week, etc.)
enum SessionGroup: String, CaseIterable {
    case today = "Today"
    case yesterday = "Yesterday"
    case lastWeek = "Last Week"
    case older = "Older"

    static func group(for date: Date) -> SessionGroup {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) {
            return .today
        } else if calendar.isDateInYesterday(date) {
            return .yesterday
        } else if let weekAgo = calendar.date(byAdding: .day, value: -7, to: Date()),
                  date > weekAgo {
            return .lastWeek
        }
        return .older
    }
}

/// Mock data for UI development
extension Session {
    static let mockSessions: [Session] = [
        Session(title: "Fix auth bug", createdAt: Date(), isActive: true),
        Session(title: "Refactor API", createdAt: Date().addingTimeInterval(-3600)),
        Session(title: "Add tests", createdAt: Date().addingTimeInterval(-86400)),
        Session(title: "Debug perf", createdAt: Date().addingTimeInterval(-90000)),
        Session(title: "Initial setup", createdAt: Date().addingTimeInterval(-604800)),
    ]
}
