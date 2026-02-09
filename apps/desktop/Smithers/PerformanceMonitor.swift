import Foundation
import Combine

final class PerformanceMonitor: ObservableObject {
    static let shared = PerformanceMonitor()

    @Published private(set) var fps: Double = 0
    @Published private(set) var frameTimeMs: Double = 0
    @Published private(set) var renderTimeMs: Double = 0
    @Published private(set) var highlightTimeMs: Double = 0
    @Published private(set) var glyphCacheHits: Int = 0
    @Published private(set) var glyphCacheMisses: Int = 0
    @Published private(set) var logFileURL: URL?

    private var overlayEnabled = false
    private var loggingEnabled = false

    private var frameSamples = SampleBuffer(capacity: 120)
    private var renderSamples = SampleBuffer(capacity: 60)
    private var highlightSamples = SampleBuffer(capacity: 60)
    private var lastFrameTimestamp: TimeInterval?

    private var logTimer: Timer?
    private var logFileHandle: FileHandle?
    private let logEncoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    var isActive: Bool {
        overlayEnabled || loggingEnabled
    }

    func setOverlayEnabled(_ enabled: Bool) {
        overlayEnabled = enabled
        updateActiveState()
    }

    func setLoggingEnabled(_ enabled: Bool) {
        guard loggingEnabled != enabled else { return }
        loggingEnabled = enabled
        updateActiveState()
        if enabled {
            startLogging()
        } else {
            stopLogging()
        }
    }

    func recordFrame(timestamp: TimeInterval) {
        guard isActive else { return }
        if let last = lastFrameTimestamp {
            let delta = max(0, timestamp - last)
            if delta > 0 {
                frameSamples.add(delta)
                let avg = frameSamples.average
                frameTimeMs = avg * 1_000
                fps = avg > 0 ? 1.0 / avg : 0
            }
        }
        lastFrameTimestamp = timestamp
    }

    func recordRender(duration: TimeInterval) {
        guard isActive else { return }
        let ms = max(0, duration * 1_000)
        renderSamples.add(ms)
        renderTimeMs = renderSamples.average
    }

    func recordHighlight(duration: TimeInterval) {
        guard isActive else { return }
        let ms = max(0, duration * 1_000)
        highlightSamples.add(ms)
        highlightTimeMs = highlightSamples.average
    }

    func recordGlyphCacheHit() {
        guard isActive else { return }
        glyphCacheHits += 1
    }

    func recordGlyphCacheMiss() {
        guard isActive else { return }
        glyphCacheMisses += 1
    }

    private func updateActiveState() {
        if !isActive {
            lastFrameTimestamp = nil
            frameSamples.reset()
            renderSamples.reset()
            highlightSamples.reset()
            fps = 0
            frameTimeMs = 0
            renderTimeMs = 0
            highlightTimeMs = 0
        }
    }

    private func startLogging() {
        logFileURL = makeLogFileURL()
        if let logFileURL {
            FileManager.default.createFile(atPath: logFileURL.path, contents: nil)
            logFileHandle = try? FileHandle(forWritingTo: logFileURL)
        }
        logTimer?.invalidate()
        logTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.logSnapshot()
        }
    }

    private func stopLogging() {
        logTimer?.invalidate()
        logTimer = nil
        logFileHandle?.closeFile()
        logFileHandle = nil
        logFileURL = nil
    }

    private func logSnapshot() {
        guard let logFileHandle else { return }
        let snapshot = PerformanceSnapshot(
            timestamp: Date(),
            fps: fps,
            frameTimeMs: frameTimeMs,
            renderTimeMs: renderTimeMs,
            highlightTimeMs: highlightTimeMs,
            glyphCacheHits: glyphCacheHits,
            glyphCacheMisses: glyphCacheMisses
        )
        guard let data = try? logEncoder.encode(snapshot) else { return }
        logFileHandle.write(data)
        logFileHandle.write(Data([0x0A]))
    }

    private func makeLogFileURL() -> URL? {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return nil
        }
        let dir = base
            .appendingPathComponent("Smithers", isDirectory: true)
            .appendingPathComponent("Performance", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        let timestamp = formatter.string(from: Date())
        return dir.appendingPathComponent("perf-\(timestamp).jsonl")
    }
}

private struct PerformanceSnapshot: Codable {
    let timestamp: Date
    let fps: Double
    let frameTimeMs: Double
    let renderTimeMs: Double
    let highlightTimeMs: Double
    let glyphCacheHits: Int
    let glyphCacheMisses: Int
}

private struct SampleBuffer {
    let capacity: Int
    private var samples: [Double] = []
    private var index: Int = 0

    fileprivate init(capacity: Int) {
        self.capacity = capacity
    }

    mutating func add(_ value: Double) {
        if samples.count < capacity {
            samples.append(value)
        } else {
            samples[index] = value
            index = (index + 1) % capacity
        }
    }

    mutating func reset() {
        samples.removeAll(keepingCapacity: true)
        index = 0
    }

    var average: Double {
        guard !samples.isEmpty else { return 0 }
        let total = samples.reduce(0, +)
        return total / Double(samples.count)
    }
}
