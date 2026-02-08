import SwiftUI
import Dispatch
import AppKit

struct CommandPaletteView: View {
    @ObservedObject var workspace: WorkspaceState
    @FocusState private var searchFocused: Bool
    @State private var selectedURL: URL?
    @State private var selectedCommandID: String?

    var body: some View {
        ZStack {
            overlayBackground
            CommandPalettePanel(
                workspace: workspace,
                selectedURL: $selectedURL,
                selectedCommandID: $selectedCommandID,
                searchFocused: $searchFocused
            )
        }
        .onExitCommand {
            workspace.hideCommandPalette()
        }
    }

    private var overlayBackground: some View {
        Color.black.opacity(0.35)
            .ignoresSafeArea()
            .onTapGesture {
                workspace.hideCommandPalette()
            }
    }

}

private struct CommandPalettePanel: View {
    @ObservedObject var workspace: WorkspaceState
    @Binding var selectedURL: URL?
    @Binding var selectedCommandID: String?
    var searchFocused: FocusState<Bool>.Binding

    var body: some View {
        let theme = workspace.theme
        let content = VStack(spacing: 0) {
            header
            Divider()
                .background(theme.dividerColor)
            paletteContent
        }

        let sized = AnyView(
            content
                .frame(width: 560, height: 360)
                .background(theme.panelBackgroundColor)
        )

        let decorated = AnyView(
            sized
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(theme.panelBorderColor)
                )
                .shadow(color: .black.opacity(0.35), radius: 18, x: 0, y: 8)
        )

        let panel = decorated
            .onAppear {
                selectedURL = workspace.fileSearchResults.first?.url
                selectedCommandID = workspace.paletteCommands.first?.id
                DispatchQueue.main.async {
                    searchFocused.wrappedValue = true
                }
            }
            .onChange(of: workspace.fileSearchResults) { _, newValue in
                if let selectedURL, newValue.contains(where: { $0.url == selectedURL }) {
                    return
                }
                selectedURL = newValue.first?.url
            }
        .onChange(of: workspace.paletteCommands.map(\.id)) { _, newValue in
            if let selectedCommandID, newValue.contains(selectedCommandID) {
                return
            }
            selectedCommandID = newValue.first
        }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("CommandPaletteOverlay")

        return panel
    }

    private var header: some View {
        HStack(spacing: 10) {
            if workspace.isCommandMode {
                Text(">")
                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.secondary)
            } else {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
            }
            TextField("Go to File...", text: $workspace.fileSearchQuery)
                .textFieldStyle(.plain)
                .font(.system(size: 13, weight: .regular))
                .foregroundStyle(.primary)
                .focused(searchFocused)
                .accessibilityIdentifier("CommandPaletteSearchField")
                .onSubmit {
                    openSelection()
                }
            Button {
                workspace.hideCommandPalette()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    private var paletteContent: AnyView {
        if workspace.isCommandMode {
            return AnyView(commandContent)
        }
        return AnyView(fileContent)
    }

    @ViewBuilder
    private var commandContent: some View {
        if workspace.paletteCommands.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "command")
                    .font(.system(size: 24))
                    .foregroundStyle(.tertiary)
                Text("No matching commands")
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List(selection: $selectedCommandID) {
                ForEach(workspace.paletteCommands) { command in
                    HStack(spacing: 8) {
                        Image(systemName: command.icon)
                            .foregroundStyle(.secondary)
                        Text(command.title)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    .tag(command.id)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        run(command)
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .accessibilityIdentifier("CommandPaletteResults")
        }
    }

    @ViewBuilder
    private var fileContent: some View {
        if workspace.fileSearchResults.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "doc.text.magnifyingglass")
                    .font(.system(size: 24))
                    .foregroundStyle(.tertiary)
                Text("No matching files")
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List(selection: $selectedURL) {
                ForEach(workspace.fileSearchResults) { entry in
                    HStack(spacing: 8) {
                        Image(systemName: iconForFile(entry.displayPath))
                            .foregroundStyle(.secondary)
                        Text(entry.displayPath)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    .tag(entry.url)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        open(entry.url)
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .accessibilityIdentifier("CommandPaletteResults")
        }
    }

    private func openSelection() {
        if workspace.isCommandMode {
            if let selectedCommandID,
               let command = workspace.paletteCommands.first(where: { $0.id == selectedCommandID }) {
                run(command)
                return
            }
            if let first = workspace.paletteCommands.first {
                run(first)
            }
            return
        }
        if let selectedURL {
            open(selectedURL)
            return
        }
        if let first = workspace.fileSearchResults.first?.url {
            open(first)
        }
    }

    private func open(_ url: URL) {
        workspace.selectFile(url)
        workspace.hideCommandPalette()
    }

    private func run(_ command: PaletteCommand) {
        command.action()
        workspace.hideCommandPalette()
    }

    private func iconForFile(_ name: String) -> String {
        let ext = (name as NSString).pathExtension.lowercased()
        switch ext {
        case "swift": return "swift"
        case "py": return "text.page"
        case "js", "ts", "jsx", "tsx": return "curlybraces"
        case "json": return "curlybraces.square"
        case "md", "txt", "readme": return "doc.plaintext"
        case "yml", "yaml", "toml": return "gearshape"
        case "png", "jpg", "jpeg", "gif", "svg", "webp", "ico": return "photo"
        case "html", "css": return "globe"
        case "sh", "zsh", "bash": return "terminal"
        case "zip", "tar", "gz": return "doc.zipper"
        case "resolved": return "lock"
        default: return "doc.text"
        }
    }
}
