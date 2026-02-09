import SwiftUI

struct SkillRegistryDetailView: View {
    let entry: SkillRegistryEntry
    @ObservedObject var workspace: WorkspaceState
    @Binding var selectedScope: SkillScope
    @State private var markdown: String = ""
    @State private var isLoading = false
    @State private var fileTree: [String] = []

    var body: some View {
        let theme = workspace.theme
        VStack(spacing: 0) {
            header(theme: theme)
            Divider()
                .background(theme.dividerColor)
            content(theme: theme)
        }
        .frame(minWidth: 760, minHeight: 560)
        .background(theme.backgroundColor)
        .onAppear {
            loadDetails()
        }
    }

    private func header(theme: AppTheme) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("\(entry.source)/\(entry.skillId)")
                    .font(.system(size: Typography.l, weight: .semibold))
                Text(entry.description)
                    .font(.system(size: Typography.s))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer()
            Picker("Scope", selection: $selectedScope) {
                Text("Project").tag(SkillScope.project)
                Text("User").tag(SkillScope.user)
            }
            .pickerStyle(.menu)
            Button("Install") {
                workspace.installRegistrySkill(entry, scope: selectedScope)
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(12)
        .background(theme.secondaryBackgroundColor)
    }

    @ViewBuilder
    private func content(theme: AppTheme) -> some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                if !fileTree.isEmpty {
                    Text("Files")
                        .font(.system(size: Typography.base, weight: .semibold))
                    ScrollView {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(fileTree, id: \.self) { item in
                                Text(item)
                                    .font(.system(size: Typography.s, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Spacer()
            }
            .frame(width: 220)
            .padding(12)
            Divider()
                .background(theme.dividerColor)
            if isLoading {
                VStack(spacing: 8) {
                    ProgressView()
                    Text("Loading skill...")
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                MarkdownView(text: markdown.isEmpty ? "(No SKILL.md available)" : markdown, theme: theme)
            }
        }
    }

    private func loadDetails() {
        isLoading = true
        Task {
            if let text = await workspace.fetchRegistryMarkdown(entry) {
                await MainActor.run {
                    markdown = text
                }
            }
            let tree = await fetchFileTree()
            await MainActor.run {
                fileTree = tree
                isLoading = false
            }
        }
    }

    private func fetchFileTree() async -> [String] {
        guard let repo = normalizeGitHubRepo(entry.source) else { return [] }
        let paths = [
            "skills/\(entry.skillId)",
            "\(entry.skillId)"
        ]
        for path in paths {
            if let items = try? await fetchGitHubContents(repo: repo, path: path), !items.isEmpty {
                return items
            }
        }
        return []
    }

    private func fetchGitHubContents(repo: String, path: String) async throws -> [String] {
        guard let url = URL(string: "https://api.github.com/repos/\(repo)/contents/\(path)") else {
            return []
        }
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            return []
        }
        let items = try JSONDecoder().decode([GitHubContentItem].self, from: data)
        return items.map { item in
            item.type == "dir" ? "\(item.name)/" : item.name
        }
    }

    private func normalizeGitHubRepo(_ source: String) -> String? {
        if source.contains("github.com") {
            guard let url = URL(string: source) else { return nil }
            let trimmed = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            return trimmed.isEmpty ? nil : trimmed
        }
        if source.contains("/") {
            return source
        }
        return nil
    }
}

private struct GitHubContentItem: Decodable {
    let name: String
    let type: String
}
