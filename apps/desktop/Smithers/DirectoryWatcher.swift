import Foundation
import Dispatch
import Darwin

final class DirectoryWatcher {
    private let source: DispatchSourceFileSystemObject

    init?(url: URL, onChange: @escaping () -> Void) {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let fd = open(url.path, O_EVTONLY)
        guard fd >= 0 else { return nil }
        source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd,
            eventMask: [.write, .delete, .rename, .attrib],
            queue: DispatchQueue.main
        )
        source.setEventHandler(handler: onChange)
        source.setCancelHandler {
            close(fd)
        }
        source.resume()
    }

    func invalidate() {
        source.cancel()
    }

    deinit {
        source.cancel()
    }
}
