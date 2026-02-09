import SwiftUI

struct SkillUseView: View {
    @ObservedObject var workspace: WorkspaceState
    @State private var filter: String = ""

    var body: some View {
        let theme = workspace.theme
        VStack(spacing: 0) {
            header(theme: theme)
            Divider()
                .background(theme.dividerColor)
            list(theme: theme)
        }
        .frame(minWidth: 720, minHeight: 520)
        .background(theme.backgroundColor)
        .onAppear {
            workspace.refreshSkills()
        }
    }

    private func header(theme: AppTheme) -> some View {
        HStack(spacing: 12) {
            Text("Use Skill")
                .font(.system(size: Typography.l, weight: .semibold))
            Spacer()
            TextField("Filter...", text: $filter)
                .textFieldStyle(.roundedBorder)
                .frame(width: 240)
        }
        .padding(12)
        .background(theme.secondaryBackgroundColor)
    }

    private func list(theme: AppTheme) -> some View {
        let filtered = workspace.skillItems.filter { skill in
            guard !filter.isEmpty else { return true }
            let query = filter.lowercased()
            return skill.name.lowercased().contains(query) || skill.description.lowercased().contains(query)
        }
        let grouped = Dictionary(grouping: filtered) { $0.scope }

        return List {
            ForEach(SkillScope.allCases.sorted { $0.order < $1.order }, id: \.self) { scope in
                if let items = grouped[scope], !items.isEmpty {
                    Section(scope.rawValue) {
                        ForEach(items) { skill in
                            SkillUseRow(skill: skill, workspace: workspace)
                        }
                    }
                }
            }
        }
        .listStyle(.inset)
    }
}

private struct SkillUseRow: View {
    let skill: SkillItem
    @ObservedObject var workspace: WorkspaceState

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(skill.name)
                        .font(.system(size: Typography.base, weight: .semibold))
                    if workspace.isSkillActive(skill) {
                        Circle()
                            .fill(Color.green)
                            .frame(width: 8, height: 8)
                    }
                }
                Text(skill.description)
                    .font(.system(size: Typography.s))
                    .foregroundStyle(.secondary)
            }
            Spacer()
            HStack(spacing: 8) {
                Button("Configure") {
                    workspace.activateSkillInline(skill)
                }
                .buttonStyle(.bordered)
                Button("New Tab") {
                    workspace.activateSkillInNewTab(skill)
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(.vertical, 6)
    }
}
