import Foundation

final class SkillRegistryClient {
    private let session: URLSession
    private var cache: [String: SkillRegistryEntry] = [:]

    init(session: URLSession = .shared) {
        self.session = session
    }

    func search(query: String, limit: Int = 20) async throws -> [SkillRegistryEntry] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        guard let url = URL(string: "https://skills.sh/api/search?q=\(trimmed.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")") else {
            return []
        }
        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            return []
        }
        let decoded = try JSONDecoder().decode(SkillsSearchResponse.self, from: data)
        let slice = Array(decoded.skills.prefix(limit))
        var entries: [SkillRegistryEntry] = []
        entries.reserveCapacity(slice.count)

        try await withThrowingTaskGroup(of: SkillRegistryEntry?.self) { group in
            for skill in slice {
                if let cached = cache[skill.id] {
                    entries.append(cached)
                    continue
                }
                group.addTask { [weak self] in
                    guard let self else { return nil }
                    return try await self.buildEntry(from: skill)
                }
            }
            for try await entry in group {
                if let entry {
                    entries.append(entry)
                    cache[entry.id] = entry
                }
            }
        }

        entries.sort { lhs, rhs in
            if let lhsStars = lhs.stars, let rhsStars = rhs.stars, lhsStars != rhsStars {
                return lhsStars > rhsStars
            }
            return lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending
        }

        return entries
    }

    func fetchSkillMarkdown(source: String, skillId: String) async -> String? {
        let candidateURLs = rawSkillMarkdownCandidates(source: source, skillId: skillId)
        for url in candidateURLs {
            if let markdown = try? await fetchText(url: url) {
                return markdown
            }
        }
        return nil
    }

    private func buildEntry(from skill: SkillsSearchResult) async throws -> SkillRegistryEntry {
        var description = ""
        var license: String?
        var stars: Int?
        var lastUpdated: Date?

        if let markdown = await fetchSkillMarkdown(source: skill.source, skillId: skill.skillId) {
            let document = SkillFrontmatterParser.parseDocument(from: markdown)
            description = document.frontmatter.description ?? ""
            if license == nil {
                license = document.frontmatter.license
            }
        }

        if let repoInfo = try? await fetchGitHubRepoInfo(source: skill.source) {
            stars = repoInfo.stars
            if license == nil {
                license = repoInfo.license
            }
            lastUpdated = repoInfo.updatedAt
        }

        if description.isEmpty {
            description = "Skill from \(skill.source)"
        }

        return SkillRegistryEntry(
            id: skill.id,
            name: skill.name,
            description: description,
            source: skill.source,
            stars: stars,
            license: license,
            lastUpdated: lastUpdated,
            tags: [],
            compatibility: ["codex"],
            installs: skill.installs,
            skillId: skill.skillId
        )
    }

    private func rawSkillMarkdownCandidates(source: String, skillId: String) -> [URL] {
        guard let repo = normalizeGitHubRepo(source) else { return [] }
        let paths = [
            "skills/\(skillId)/SKILL.md",
            "\(skillId)/SKILL.md"
        ]
        let branches = ["main", "master"]
        var urls: [URL] = []
        for branch in branches {
            for path in paths {
                let urlString = "https://raw.githubusercontent.com/\(repo)/\(branch)/\(path)"
                if let url = URL(string: urlString) {
                    urls.append(url)
                }
            }
        }
        return urls
    }

    private func fetchGitHubRepoInfo(source: String) async throws -> GitHubRepoInfo {
        guard let repo = normalizeGitHubRepo(source) else {
            throw RegistryError.invalidRepo
        }
        guard let url = URL(string: "https://api.github.com/repos/\(repo)") else {
            throw RegistryError.invalidRepo
        }
        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw RegistryError.requestFailed
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let payload = try decoder.decode(GitHubRepoResponse.self, from: data)
        return GitHubRepoInfo(stars: payload.stargazersCount, license: payload.license?.spdxId, updatedAt: payload.updatedAt)
    }

    private func fetchText(url: URL) async throws -> String {
        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw RegistryError.requestFailed
        }
        guard let text = String(data: data, encoding: .utf8) else {
            throw RegistryError.invalidResponse
        }
        return text
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

    private struct SkillsSearchResponse: Decodable {
        let query: String
        let searchType: String
        let skills: [SkillsSearchResult]
    }

    private struct SkillsSearchResult: Decodable {
        let id: String
        let skillId: String
        let name: String
        let installs: Int?
        let source: String
    }

    private struct GitHubRepoResponse: Decodable {
        let stargazersCount: Int
        let license: GitHubLicense?
        let updatedAt: Date?

        private enum CodingKeys: String, CodingKey {
            case stargazersCount = "stargazers_count"
            case license
            case updatedAt = "updated_at"
        }
    }

    private struct GitHubLicense: Decodable {
        let spdxId: String?

        private enum CodingKeys: String, CodingKey {
            case spdxId = "spdx_id"
        }
    }

    private struct GitHubRepoInfo {
        let stars: Int
        let license: String?
        let updatedAt: Date?
    }

    private enum RegistryError: Error {
        case invalidRepo
        case requestFailed
        case invalidResponse
    }
}
