import SwiftUI

struct SearchPanelView: View {
    @ObservedObject var workspace: WorkspaceState
    @FocusState private var searchFocused: Bool
    @State private var selection: SearchMatchSelection?

    private struct SearchMatchSelection: Hashable {
        let resultID: UUID
        let matchID: UUID
    }

    var body: some View {
        let theme = workspace.theme
        VStack(spacing: 0) {
            header
            Divider()
                .background(theme.dividerColor)
            content
        }
        .background(theme.secondaryBackgroundColor)
        .onAppear {
            DispatchQueue.main.async {
                searchFocused = true
            }
        }
        .onExitCommand {
            workspace.hideSearchPanel()
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
            TextField("Search in files", text: $workspace.searchQuery)
                .textFieldStyle(.plain)
                .font(.system(size: Typography.base, weight: .regular))
                .foregroundStyle(.primary)
                .focused($searchFocused)
                .accessibilityIdentifier("SearchInFilesField")
            Button {
                workspace.hideSearchPanel()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private var content: some View {
        let trimmedQuery = workspace.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if workspace.isSearchInProgress {
            searchInProgressView
        } else if let message = workspace.searchErrorMessage {
            searchErrorView(message)
        } else if trimmedQuery.isEmpty {
            emptyQueryView
        } else if workspace.searchResults.isEmpty {
            emptyResultsView
        } else {
            searchResultsView(theme: workspace.theme)
        }
    }

    private var searchInProgressView: some View {
        VStack(spacing: 8) {
            ProgressView()
                .controlSize(.small)
            Text("Searching...")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func searchErrorView(_ message: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: Typography.iconM))
                .foregroundStyle(.secondary)
            Text(message)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyQueryView: some View {
        VStack(spacing: 8) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: Typography.iconM))
                .foregroundStyle(.tertiary)
            Text("Search for text in the workspace")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyResultsView: some View {
        VStack(spacing: 8) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: Typography.iconM))
                .foregroundStyle(.tertiary)
            Text("No matches found")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func searchResultsView(theme: AppTheme) -> some View {
        VStack(spacing: 0) {
            List(selection: $selection) {
                ForEach(workspace.searchResults) { result in
                    Section(result.displayPath) {
                        ForEach(result.matches) { match in
                            SearchMatchRow(match: match)
                                .tag(SearchMatchSelection(resultID: result.id, matchID: match.id))
                                .contentShape(Rectangle())
                                .onTapGesture {
                                    workspace.openSearchResult(result, match: match)
                                }
                        }
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .accessibilityIdentifier("SearchInFilesResults")
            Divider()
                .background(theme.dividerColor)
            SearchPreviewView(preview: workspace.searchPreview, theme: theme)
                .frame(minHeight: 120, idealHeight: 160, maxHeight: 240)
        }
        .onChange(of: selection) { _, newValue in
            guard let newValue else {
                workspace.clearSearchPreview()
                return
            }
            guard let result = workspace.searchResults.first(where: { $0.id == newValue.resultID }),
                  let match = result.matches.first(where: { $0.id == newValue.matchID }) else {
                workspace.clearSearchPreview()
                return
            }
            workspace.updateSearchPreview(result: result, match: match)
        }
        .onChange(of: workspace.searchResults) { _, _ in
            selection = nil
            workspace.clearSearchPreview()
        }
    }
}

private struct SearchMatchRow: View {
    let match: SearchMatch

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("\(match.lineNumber)")
                .font(.system(size: Typography.s, weight: .medium, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 36, alignment: .trailing)
            Text(match.lineText.trimmingCharacters(in: .whitespaces))
                .font(.system(size: Typography.code, weight: .regular, design: .monospaced))
                .foregroundStyle(.primary)
                .lineLimit(2)
                .truncationMode(.tail)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 2)
    }
}

private struct SearchPreviewView: View {
    let preview: SearchPreview?
    let theme: AppTheme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text("Preview")
                    .font(.system(size: Typography.s, weight: .semibold))
                    .foregroundStyle(theme.mutedForegroundColor)
                Spacer()
                if let preview {
                    Text(preview.displayPath)
                        .font(.system(size: Typography.s))
                        .foregroundStyle(theme.mutedForegroundColor)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            Divider()
                .background(theme.dividerColor)
            if let preview {
                ScrollView {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(preview.lines) { line in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text("\(line.number)")
                                    .font(.system(size: Typography.s, weight: .medium, design: .monospaced))
                                    .foregroundStyle(theme.mutedForegroundColor)
                                    .frame(width: 36, alignment: .trailing)
                                Text(line.text)
                                    .font(.system(size: Typography.code, weight: .regular, design: .monospaced))
                                    .foregroundStyle(theme.foregroundColor)
                                    .lineLimit(1)
                                    .truncationMode(.tail)
                            }
                            .padding(.vertical, 2)
                            .background(line.isMatch ? theme.lineHighlightColor.opacity(0.6) : Color.clear)
                            .cornerRadius(4)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                if preview.isTruncated {
                    Text("Preview truncated for large files")
                        .font(.system(size: Typography.xs))
                        .foregroundStyle(theme.mutedForegroundColor)
                }
            } else {
                Text("Select a match to preview")
                    .font(.system(size: Typography.s))
                    .foregroundStyle(theme.mutedForegroundColor)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(theme.secondaryBackgroundColor)
    }
}

struct SearchPanelOverlay: View {
    @ObservedObject var workspace: WorkspaceState

    var body: some View {
        GeometryReader { proxy in
            let width = min(560, proxy.size.width * 0.55)
            let height = min(520, proxy.size.height * 0.65)
            ZStack(alignment: .topLeading) {
                Color.black.opacity(0.2)
                    .ignoresSafeArea()
                    .onTapGesture {
                        workspace.hideSearchPanel()
                    }
                SearchPanelView(workspace: workspace)
                    .frame(width: width, height: height)
                    .background(workspace.theme.panelBackgroundColor)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(workspace.theme.panelBorderColor)
                    )
                    .shadow(color: .black.opacity(0.35), radius: 18, x: 0, y: 8)
                    .padding(.leading, 20)
                    .padding(.top, 60)
            }
        }
    }
}
