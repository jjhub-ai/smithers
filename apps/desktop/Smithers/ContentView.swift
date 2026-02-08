import SwiftUI
import STTextView

struct CodeEditor: NSViewRepresentable {
    @Binding var text: String

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = STTextView.scrollableTextView()
        let textView = scrollView.documentView as! STTextView

        textView.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
        textView.backgroundColor = NSColor(red: 0.11, green: 0.12, blue: 0.14, alpha: 1)
        textView.insertionPointColor = .white
        textView.highlightSelectedLine = true
        textView.selectedLineHighlightColor = NSColor(white: 0.18, alpha: 1)
        textView.widthTracksTextView = true
        textView.textColor = .white
        textView.delegate = context.coordinator
        let rulerView = STLineNumberRulerView(textView: textView)
        rulerView.backgroundColor = NSColor(red: 0.11, green: 0.12, blue: 0.14, alpha: 1)
        rulerView.textColor = NSColor(white: 0.35, alpha: 1)
        rulerView.highlightSelectedLine = true
        rulerView.selectedLineTextColor = NSColor(white: 0.55, alpha: 1)
        rulerView.drawSeparator = false
        rulerView.rulerInsets = STRulerInsets(leading: 8, trailing: 8)
        scrollView.verticalRulerView = rulerView
        scrollView.rulersVisible = true

        setTextViewContent(textView, text: text)

        scrollView.backgroundColor = NSColor(red: 0.11, green: 0.12, blue: 0.14, alpha: 1)
        scrollView.scrollerStyle = .overlay
        scrollView.setAccessibilityIdentifier("CodeEditor")
        textView.setAccessibilityIdentifier("CodeEditorTextView")

        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? STTextView else { return }
        let current = textView.attributedString().string
        if current != text {
            context.coordinator.ignoreNextChange = true
            setTextViewContent(textView, text: text)
        }
    }

    private func setTextViewContent(_ textView: STTextView, text: String) {
        let attrs: [NSAttributedString.Key: Any] = [
            .foregroundColor: NSColor.white,
            .font: NSFont.monospacedSystemFont(ofSize: 13, weight: .regular),
        ]
        textView.setAttributedString(NSAttributedString(string: text, attributes: attrs))
        let fullRange = NSRange(location: 0, length: (text as NSString).length)
        textView.setTextColor(.white, range: fullRange)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    class Coordinator: NSObject, STTextViewDelegate {
        var parent: CodeEditor
        var ignoreNextChange = false

        init(parent: CodeEditor) {
            self.parent = parent
        }

        func textViewDidChangeText(_ notification: Notification) {
            if ignoreNextChange {
                ignoreNextChange = false
                return
            }
            guard let textView = notification.object as? STTextView else { return }
            parent.text = textView.attributedString().string
        }
    }
}

struct ContentView: View {
    @ObservedObject var workspace: WorkspaceState

    var body: some View {
        NavigationSplitView {
            FileTreeSidebar(workspace: workspace)
                .navigationSplitViewColumnWidth(min: 180, ideal: 240, max: 400)
        } detail: {
            if workspace.selectedFileURL != nil {
                CodeEditor(text: $workspace.editorText)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                emptyEditor
            }
        }
        .navigationTitle("")
        .toolbar {
            ToolbarItem(placement: .principal) {
                if !workspace.openFiles.isEmpty {
                    TabBar(workspace: workspace)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private var emptyEditor: some View {
        VStack(spacing: 8) {
            Image(systemName: "doc.text")
                .font(.system(size: 40))
                .foregroundStyle(.tertiary)
            Text("Select a file to edit")
                .font(.title3)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: NSColor(red: 0.11, green: 0.12, blue: 0.14, alpha: 1)))
    }
}

struct TabBar: View {
    @ObservedObject var workspace: WorkspaceState

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(workspace.openFiles, id: \.self) { url in
                    TabBarItem(
                        title: url.lastPathComponent,
                        subtitle: workspace.displayPath(for: url),
                        icon: iconForFile(url.lastPathComponent),
                        isSelected: url == workspace.selectedFileURL,
                        onSelect: {
                            workspace.selectFile(url)
                        },
                        onClose: {
                            workspace.closeFile(url)
                        }
                    )
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
        }
        .accessibilityIdentifier("EditorTabBar")
    }
}

struct TabBarItem: View {
    let title: String
    let subtitle: String
    let icon: String
    let isSelected: Bool
    let onSelect: () -> Void
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.system(size: 12, weight: .medium))
                .lineLimit(1)
                .truncationMode(.middle)
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.secondary)
                    .padding(4)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close \(title)")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(isSelected ? Color.white.opacity(0.10) : Color.clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .strokeBorder(Color.white.opacity(isSelected ? 0.12 : 0.05))
        )
        .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .onTapGesture(perform: onSelect)
        .help(subtitle)
    }
}

private func iconForFile(_ name: String) -> String {
    let ext = (name as NSString).pathExtension.lowercased()
    switch ext {
    case "swift": return "swift"
    case "py": return "text.page"
    case "js", "ts", "jsx", "tsx": return "curlybraces"
    case "json": return "curlybraces.square"
    case "md", "txt", "readme": return "doc.plaintext"
    case "yml", "yaml", "toml": return "gearshape"
    case "png", "jpg", "jpeg", "gif", "svg", "webp", "ico": return "photo"
    case "html", "css": return "globe"
    case "sh", "zsh", "bash": return "terminal"
    case "zip", "tar", "gz": return "doc.zipper"
    case "resolved": return "lock"
    default: return "doc.text"
    }
}
