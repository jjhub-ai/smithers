import SwiftUI

struct TerminalTabView: NSViewRepresentable {
    let view: GhosttyTerminalView

    func makeNSView(context: Context) -> GhosttyTerminalView {
        view
    }

    func updateNSView(_ nsView: GhosttyTerminalView, context: Context) {
    }
}

struct TerminalTabBarItem: View {
    @ObservedObject var view: GhosttyTerminalView
    let isSelected: Bool
    let theme: AppTheme
    let onSelect: () -> Void
    let onClose: () -> Void

    var body: some View {
        let title = view.title.isEmpty ? "Terminal" : view.title
        let subtitle = view.pwd ?? "Terminal"
        TabBarItem(
            title: title,
            subtitle: subtitle,
            icon: "terminal",
            isSelected: isSelected,
            theme: theme,
            onSelect: onSelect,
            onClose: onClose
        )
    }
}
