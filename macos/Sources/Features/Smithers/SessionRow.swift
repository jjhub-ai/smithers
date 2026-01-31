import SwiftUI

/// A single row in the session sidebar
struct SessionRow: View {
    let session: Session
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 8) {
            // Active indicator dot
            Circle()
                .fill(session.isActive ? Color.green : Color.clear)
                .frame(width: 8, height: 8)

            // Session title
            Text(session.title)
                .font(.system(size: 13))
                .foregroundColor(isSelected ? .white : .primary)
                .lineLimit(1)
                .truncationMode(.tail)

            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(isSelected ? Color.accentColor : Color.clear)
        )
        .contentShape(Rectangle())
    }
}

#Preview {
    VStack(spacing: 4) {
        SessionRow(session: Session(title: "Fix auth bug", isActive: true), isSelected: true)
        SessionRow(session: Session(title: "Refactor API"), isSelected: false)
        SessionRow(session: Session(title: "A very long session title that should truncate"), isSelected: false)
    }
    .padding()
    .frame(width: 250)
}
