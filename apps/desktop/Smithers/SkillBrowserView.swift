import SwiftUI

struct SkillBrowserView: View {
    @ObservedObject var workspace: WorkspaceState
    @State private var searchQuery: String = ""
    @State private var results: [SkillRegistryEntry] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var installInput: String = ""
    @State private var selectedScope: SkillScope = .project
    @State private var selectedDetail: SkillRegistryEntry?
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        let theme = workspace.theme
        VStack(spacing: 0) {
            header(theme: theme)
            Divider()
                .background(theme.dividerColor)
            content(theme: theme)
            Divider()
                .background(theme.dividerColor)
            footer(theme: theme)
        }
        .frame(minWidth: 760, minHeight: 560)
        .background(theme.backgroundColor)
        .onAppear {
            selectedScope = workspace.rootDirectory == nil ? .user : .project
        }
        .sheet(item: $selectedDetail) { entry in
            SkillRegistryDetailView(entry: entry, workspace: workspace, selectedScope: $selectedScope)
        }
    }

    private func header(theme: AppTheme) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "sparkles")
                .foregroundStyle(theme.accentColor)
            TextField("Search skills...", text: $searchQuery)
                .textFieldStyle(.roundedBorder)
                .onChange(of: searchQuery) { _, _ in
                    scheduleSearch()
                }
            Picker("Scope", selection: $selectedScope) {
                Text("Project").tag(SkillScope.project)
                Text("User").tag(SkillScope.user)
            }
            .pickerStyle(.menu)
            Spacer()
        }
        .padding(12)
        .background(theme.secondaryBackgroundColor)
    }

    @ViewBuilder
    private func content(theme: AppTheme) -> some View {
        if searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            featuredView(theme: theme)
        } else if isLoading {
            VStack(spacing: 8) {
                ProgressView()
                Text("Searching...")
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage {
            VStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: Typography.iconM))
                    .foregroundStyle(.secondary)
                Text(errorMessage)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if results.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: Typography.iconM))
                    .foregroundStyle(.secondary)
                Text("No skills found")
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List {
                Section("Results") {
                    ForEach(results) { entry in
                        SkillRegistryRow(entry: entry, selectedScope: $selectedScope) {
                            selectedDetail = entry
                        } onInstall: {
                            workspace.installRegistrySkill(entry, scope: selectedScope)
                        }
                    }
                }
            }
            .listStyle(.inset)
        }
    }

    private func featuredView(theme: AppTheme) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Featured")
                .font(.system(size: Typography.base, weight: .semibold))
                .padding(.horizontal, 12)
            HStack(spacing: 12) {
                featuredCard(title: "observability", subtitle: "Monitor & debug with full traces")
                featuredCard(title: "testing", subtitle: "Improve test coverage")
                featuredCard(title: "security", subtitle: "OWASP top 10 checks")
            }
            .padding(.horizontal, 12)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.top, 16)
    }

    private func featuredCard(title: String, subtitle: String) -> some View {
        Button {
            searchQuery = title
            scheduleSearch()
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.system(size: Typography.base, weight: .semibold))
                Text(subtitle)
                    .font(.system(size: Typography.s))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color(nsColor: workspace.theme.panelBackground))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(workspace.theme.panelBorderColor)
            )
        }
        .buttonStyle(.plain)
    }

    private func footer(theme: AppTheme) -> some View {
        HStack(spacing: 12) {
            Text("Install from URL or repo:")
                .font(.system(size: Typography.s, weight: .semibold))
            TextField("github.com/org/repo@skill", text: $installInput)
                .textFieldStyle(.roundedBorder)
            Button("Install") {
                let trimmed = installInput.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { return }
                workspace.installSkill(from: trimmed, scope: selectedScope)
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(12)
        .background(theme.secondaryBackgroundColor)
    }

    private func scheduleSearch() {
        searchTask?.cancel()
        let query = searchQuery
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 250_000_000)
            await performSearch(query: query)
        }
    }

    @MainActor
    private func performSearch(query: String) async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            results = []
            isLoading = false
            errorMessage = nil
            return
        }
        isLoading = true
        errorMessage = nil
        do {
            let entries = try await workspace.searchRegistry(query: trimmed)
            results = entries
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

private struct SkillRegistryRow: View {
    let entry: SkillRegistryEntry
    @Binding var selectedScope: SkillScope
    let onView: () -> Void
    let onInstall: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(entryDisplayName)
                    .font(.system(size: Typography.base, weight: .semibold))
                Text(entry.description)
                    .font(.system(size: Typography.s))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                HStack(spacing: 10) {
                    if let stars = entry.stars {
                        Label("\(stars)", systemImage: "star")
                    }
                    if let license = entry.license {
                        Text(license)
                    }
                    if let lastUpdated = entry.lastUpdated {
                        Text("Updated \(lastUpdated.formatted(date: .abbreviated, time: .omitted))")
                    }
                }
                .font(.system(size: Typography.xs))
                .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(spacing: 6) {
                Button("View") {
                    onView()
                }
                .buttonStyle(.bordered)
                Button("Install") {
                    onInstall()
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(.vertical, 6)
    }

    private var entryDisplayName: String {
        "\(entry.source)/\(entry.skillId)"
    }
}
