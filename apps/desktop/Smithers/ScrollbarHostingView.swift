import AppKit

final class ScrollbarHostingView: NSView {
    let contentView: NSView
    let scrollbarView: ScrollbarOverlayView
    let overlayView: NSView?

    init(contentView: NSView, scrollbarView: ScrollbarOverlayView, overlayView: NSView? = nil) {
        self.contentView = contentView
        self.scrollbarView = scrollbarView
        self.overlayView = overlayView
        super.init(frame: .zero)
        wantsLayer = true
        layer?.masksToBounds = true
        addSubview(contentView)
        if let overlayView {
            addSubview(overlayView)
        }
        addSubview(scrollbarView)
    }

    required init?(coder: NSCoder) {
        return nil
    }

    override func layout() {
        super.layout()
        contentView.frame = bounds
        overlayView?.frame = bounds
        let width = scrollbarView.preferredWidth
        scrollbarView.frame = NSRect(
            x: max(0, bounds.width - width),
            y: 0,
            width: width,
            height: bounds.height
        )
    }
}
