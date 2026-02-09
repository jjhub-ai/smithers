import Foundation

enum ThreadHistoryStore {
    private static let threadMapKey = "smithers.threadMap"

    static func loadThreadId(for rootDirectory: URL) -> String? {
        let map = UserDefaults.standard.dictionary(forKey: threadMapKey) as? [String: String] ?? [:]
        return map[normalizedPath(for: rootDirectory)]
    }

    static func saveThreadId(_ threadId: String, for rootDirectory: URL) {
        var map = UserDefaults.standard.dictionary(forKey: threadMapKey) as? [String: String] ?? [:]
        map[normalizedPath(for: rootDirectory)] = threadId
        UserDefaults.standard.set(map, forKey: threadMapKey)
    }

    static func removeThreadId(for rootDirectory: URL) {
        var map = UserDefaults.standard.dictionary(forKey: threadMapKey) as? [String: String] ?? [:]
        map.removeValue(forKey: normalizedPath(for: rootDirectory))
        UserDefaults.standard.set(map, forKey: threadMapKey)
    }

    private static func normalizedPath(for rootDirectory: URL) -> String {
        rootDirectory.standardizedFileURL.path
    }
}
