import SwiftUI

struct SkillListView: View {
    @ObservedObject var workspace: WorkspaceState
    @State private var searchQuery: String = ""

    var body: some View {
        let theme = workspace.theme
        VStack(spacing: 0) {
            header(theme: theme)
            Divider()
                .background(theme.dividerColor)
            content(theme: theme)
        }
        .frame(minWidth: 720, minHeight: 520)
        .background(theme.backgroundColor)
        .onAppear {
            workspace.refreshSkills()
        }
    }

    private func header(theme: AppTheme) -> some View {
        HStack(spacing: 12) {
            Text("Manage Skills")
                .font(.system(size: Typography.l, weight: .semibold))
            Spacer()
            TextField("Search skills", text: $searchQuery)
                .textFieldStyle(.roundedBorder)
                .frame(width: 220)
            Button("Refresh") {
                workspace.refreshSkills(force: true)
            }
            .buttonStyle(.bordered)
        }
        .padding(12)
        .background(theme.secondaryBackgroundColor)
    }

    private func content(theme: AppTheme) -> some View {
        let filtered = workspace.skillItems.filter { item in
            guard !searchQuery.isEmpty else { return true }
            let query = searchQuery.lowercased()
            return item.name.lowercased().contains(query) || item.description.lowercased().contains(query)
        }
        if filtered.isEmpty {
            return AnyView(
                VStack(spacing: 8) {
                    Image(systemName: "sparkles")
                        .font(.system(size: Typography.iconM))
                        .foregroundStyle(.tertiary)
                    Text("No installed skills")
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            )
        }
        let grouped = Dictionary(grouping: filtered) { $0.scope }
        return AnyView(
            List {
                ForEach(SkillScope.allCases.sorted { $0.order < $1.order }, id: \.self) { scope in
                    if let items = grouped[scope], !items.isEmpty {
                        Section(scope.rawValue) {
                            ForEach(items) { skill in
                                SkillManageRow(skill: skill, workspace: workspace)
                            }
                        }
                    }
                }
            }
            .listStyle(.inset)
        )
    }
}

private struct SkillManageRow: View {
    let skill: SkillItem
    @ObservedObject var workspace: WorkspaceState

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(skill.name)
                        .font(.system(size: Typography.base, weight: .semibold))
                    Text(skill.description)
                        .font(.system(size: Typography.s))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                Spacer()
                if let installedAt = skill.installedAt {
                    Text(installedAt.formatted(date: .abbreviated, time: .omitted))
                        .font(.system(size: Typography.xs))
                        .foregroundStyle(.secondary)
                }
            }
            HStack(spacing: 8) {
                Button("View") {
                    workspace.openSkillDetail(skill)
                }
                .buttonStyle(.borderless)
                if skill.source != nil {
                    Button("Update") {
                        workspace.updateSkill(skill)
                    }
                    .buttonStyle(.borderless)
                }
                Button("Remove") {
                    workspace.removeSkill(skill)
                }
                .buttonStyle(.borderless)
                Menu("Move") {
                    if skill.scope != .project {
                        Button("Move to Project") { workspace.moveSkill(skill, to: .project) }
                    }
                    if skill.scope != .user {
                        Button("Move to User") { workspace.moveSkill(skill, to: .user) }
                    }
                }
                .menuStyle(.borderlessButton)
            }
            .font(.system(size: Typography.s, weight: .medium))
        }
        .padding(.vertical, 6)
    }
}
