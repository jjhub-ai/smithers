import Foundation

final class SkillScanner {
    struct ScanOutput {
        let skills: [SkillItem]
        let errors: [String]
    }

    func scan(rootDirectory: URL?) async -> ScanOutput {
        let directories = skillDirectories(rootDirectory: rootDirectory)
        var skills: [SkillItem] = []
        var errors: [String] = []
        let installStore = SkillInstallStore.shared

        for entry in directories {
            let scope = entry.scope
            let directoryURL = entry.url
            guard let children = try? FileManager.default.contentsOfDirectory(
                at: directoryURL,
                includingPropertiesForKeys: [.isDirectoryKey],
                options: [.skipsHiddenFiles]
            ) else { continue }
            for child in children {
                let skillURL = child
                guard isDirectory(skillURL) else { continue }
                let skillFile = skillURL.appendingPathComponent("SKILL.md")
                guard FileManager.default.fileExists(atPath: skillFile.path) else { continue }
                do {
                    let contents = try String(contentsOf: skillFile, encoding: .utf8)
                    let document = SkillFrontmatterParser.parseDocument(from: contents)
                    guard let name = document.frontmatter.name, let description = document.frontmatter.description else {
                        errors.append("Missing name/description in \(skillFile.path)")
                        continue
                    }
                    let hasScripts = FileManager.default.fileExists(
                        atPath: skillURL.appendingPathComponent("scripts").path
                    )
                    let record = installStore.record(for: skillURL)
                    let item = SkillItem(
                        name: name,
                        description: description,
                        scope: scope,
                        path: skillURL,
                        license: document.frontmatter.license,
                        metadata: document.frontmatter.metadata,
                        allowedTools: document.frontmatter.allowedTools,
                        hasScripts: hasScripts,
                        argumentHint: document.frontmatter.argumentHint,
                        source: record?.source,
                        installedAt: record?.installedAt,
                        enabled: true
                    )
                    skills.append(item)
                } catch {
                    errors.append("Failed to read \(skillFile.path): \(error.localizedDescription)")
                }
            }
        }

        skills.sort { lhs, rhs in
            if lhs.scope.order != rhs.scope.order { return lhs.scope.order < rhs.scope.order }
            return lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending
        }

        return ScanOutput(skills: skills, errors: errors)
    }

    func skillDirectories(rootDirectory: URL?) -> [(scope: SkillScope, url: URL)] {
        var results: [(SkillScope, URL)] = []
        var seen: Set<String> = []
        let fm = FileManager.default

        if let rootDirectory {
            var current = rootDirectory
            while true {
                let candidate = current.appendingPathComponent(".agents/skills", isDirectory: true)
                let path = candidate.standardizedFileURL.path
                if fm.fileExists(atPath: path), !seen.contains(path) {
                    results.append((.project, candidate))
                    seen.insert(path)
                }
                let parent = current.deletingLastPathComponent()
                if parent.path == current.path { break }
                current = parent
            }
        }

        let home = fm.homeDirectoryForCurrentUser
        let userSkills = home.appendingPathComponent(".agents/skills", isDirectory: true)
        if fm.fileExists(atPath: userSkills.path), !seen.contains(userSkills.path) {
            results.append((.user, userSkills))
            seen.insert(userSkills.path)
        }

        let adminSkills = URL(fileURLWithPath: "/etc/codex/skills", isDirectory: true)
        if fm.fileExists(atPath: adminSkills.path), !seen.contains(adminSkills.path) {
            results.append((.admin, adminSkills))
            seen.insert(adminSkills.path)
        }

        return results
    }

    private func isDirectory(_ url: URL) -> Bool {
        let values = try? url.resourceValues(forKeys: [.isDirectoryKey])
        return values?.isDirectory == true
    }
}
