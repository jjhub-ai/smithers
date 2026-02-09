import Foundation
import Darwin

enum SmithersIPC {
    static var socketPath: String {
        "/tmp/smithers-\(getuid()).sock"
    }

    static var socketURL: URL {
        URL(fileURLWithPath: socketPath)
    }
}

struct SmithersIPCOpenItem: Codable {
    let path: String
    let line: Int?
    let column: Int?
    let wait: Bool?

    init(path: String, line: Int? = nil, column: Int? = nil, wait: Bool? = nil) {
        self.path = path
        self.line = line
        self.column = column
        self.wait = wait
    }
}

struct SmithersIPCRequest: Codable {
    let items: [SmithersIPCOpenItem]
}

struct SmithersIPCResponse: Codable {
    enum Status: String, Codable {
        case ok
        case error
    }

    let status: Status
    let message: String?
}
