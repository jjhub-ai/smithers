import Foundation
import Sparkle

@MainActor
final class UpdateController: NSObject, ObservableObject {
    private lazy var updaterController = SPUStandardUpdaterController(
        startingUpdater: true,
        updaterDelegate: self,
        userDriverDelegate: nil
    )

    override init() {
        super.init()
        _ = updaterController
    }

    func checkForUpdates() {
        updaterController.checkForUpdates(nil)
    }
}

extension UpdateController: SPUUpdaterDelegate {
    nonisolated func feedURLString(for updater: SPUUpdater) -> String? {
        let channel = UpdateChannel.loadFromDefaults()
        let releaseFeed = Self.feedURLString(forInfoKey: "SUFeedURL")
        let snapshotFeed = Self.feedURLString(forInfoKey: "SUSnapshotFeedURL")
        switch channel {
        case .snapshot:
            return snapshotFeed ?? releaseFeed
        case .release:
            return releaseFeed ?? snapshotFeed
        }
    }
}

private extension UpdateController {
    nonisolated static func feedURLString(forInfoKey key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
