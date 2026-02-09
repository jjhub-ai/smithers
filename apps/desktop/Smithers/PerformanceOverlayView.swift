import SwiftUI
import Foundation

#if DEBUG
struct PerformanceOverlayView: View {
    @ObservedObject var monitor: PerformanceMonitor
    let theme: AppTheme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            metricRow(label: "FPS", value: formatNumber(monitor.fps, digits: 1))
            metricRow(label: "Frame", value: formatMilliseconds(monitor.frameTimeMs))
            metricRow(label: "Render", value: formatMilliseconds(monitor.renderTimeMs))
            metricRow(label: "Highlight", value: formatMilliseconds(monitor.highlightTimeMs))
            metricRow(
                label: "Glyph cache",
                value: "\(monitor.glyphCacheHits) hit / \(monitor.glyphCacheMisses) miss"
            )
            if let logURL = monitor.logFileURL {
                Text("Log: \(logURL.lastPathComponent)")
                    .font(.system(size: Typography.xs, design: .monospaced))
                    .foregroundStyle(theme.mutedForegroundColor)
                    .lineLimit(1)
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(theme.panelBackgroundColor.opacity(0.92))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(theme.panelBorderColor.opacity(0.7))
        )
    }

    @ViewBuilder
    private func metricRow(label: String, value: String) -> some View {
        HStack(spacing: 8) {
            Text(label)
                .foregroundStyle(theme.mutedForegroundColor)
            Spacer(minLength: 12)
            Text(value)
                .foregroundStyle(theme.foregroundColor)
        }
        .font(.system(size: Typography.s, weight: .semibold, design: .monospaced))
    }

    private func formatNumber(_ value: Double, digits: Int) -> String {
        guard value > 0 else { return "--" }
        return String(format: "%.\(digits)f", value)
    }

    private func formatMilliseconds(_ value: Double) -> String {
        guard value > 0 else { return "--" }
        return String(format: "%.2f ms", value)
    }
}

struct PerformanceFrameTicker: View {
    @ObservedObject var monitor: PerformanceMonitor

    var body: some View {
        TimelineView(.animation) { context in
            Color.clear
                .onChange(of: context.date) { _ in
                    monitor.recordFrame(timestamp: ProcessInfo.processInfo.systemUptime)
                }
        }
    }
}
#endif
