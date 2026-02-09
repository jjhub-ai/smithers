import Foundation

final class SkillInstallStore {
    static let shared = SkillInstallStore()

    private let fileURL: URL
    private var records: [String: SkillInstallRecord] = [:]
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    private init() {
        let fm = FileManager.default
        let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        fileURL = (base ?? fm.homeDirectoryForCurrentUser)
            .appendingPathComponent("Smithers", isDirectory: true)
            .appendingPathComponent("Skills", isDirectory: true)
            .appendingPathComponent("installed.json")
        decoder.dateDecodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        load()
    }

    func record(for path: URL) -> SkillInstallRecord? {
        records[path.standardizedFileURL.path]
    }

    func upsert(record: SkillInstallRecord) {
        records[record.path] = record
        persist()
    }

    func remove(path: URL) {
        records.removeValue(forKey: path.standardizedFileURL.path)
        persist()
    }

    func allRecords() -> [SkillInstallRecord] {
        Array(records.values)
    }

    private func load() {
        guard let data = try? Data(contentsOf: fileURL) else { return }
        if let decoded = try? decoder.decode([SkillInstallRecord].self, from: data) {
            records = Dictionary(uniqueKeysWithValues: decoded.map { ($0.path, $0) })
        }
    }

    private func persist() {
        let directory = fileURL.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let payload = Array(records.values)
        guard let data = try? encoder.encode(payload) else { return }
        try? data.write(to: fileURL, options: [.atomic])
    }
}
