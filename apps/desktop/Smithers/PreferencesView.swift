import SwiftUI
import AppKit

struct PreferencesView: View {
    @ObservedObject var workspace: WorkspaceState

    var body: some View {
        Form {
            Section("Editor") {
                Picker("Font", selection: $workspace.editorFontName) {
                    ForEach(workspace.availableEditorFonts, id: \.self) { name in
                        Text(displayName(for: name))
                            .tag(name)
                    }
                }
                HStack {
                    Text("Size")
                    Spacer()
                    Stepper(
                        value: $workspace.editorFontSize,
                        in: WorkspaceState.minEditorFontSize...WorkspaceState.maxEditorFontSize,
                        step: 1
                    ) {
                        Text("\(Int(workspace.editorFontSize)) pt")
                            .font(.system(size: Typography.base, weight: .semibold))
                    }
                }
                Picker("Scrollbar", selection: $workspace.scrollbarVisibilityMode) {
                    ForEach(ScrollbarVisibilityMode.allCases) { mode in
                        Text(mode.label)
                            .tag(mode)
                    }
                }
            }

            Section("Files") {
                Toggle("Warn before closing with unsaved changes", isOn: $workspace.isCloseWarningEnabled)
                Toggle("Auto Save", isOn: $workspace.isAutoSaveEnabled)
                Picker("Auto Save Interval", selection: $workspace.autoSaveInterval) {
                    Text("5 seconds").tag(5.0)
                    Text("10 seconds").tag(10.0)
                    Text("30 seconds").tag(30.0)
                }
                .disabled(!workspace.isAutoSaveEnabled)
            }

            Section("Neovim") {
                HStack(spacing: 8) {
                    TextField("/path/to/nvim", text: $workspace.preferredNvimPath)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: Typography.base, design: .monospaced))
                    Button("Choose...") {
                        workspace.chooseNvimPath()
                    }
                }
                HStack {
                    Text(workspace.nvimPathStatusMessage)
                        .font(.system(size: Typography.s))
                        .foregroundStyle(workspace.nvimPathStatusIsError ? Color.red : Color.secondary)
                    Spacer()
                    Button("Use Default") {
                        workspace.clearNvimPath()
                    }
                }
            }

            Section("Progress Bar") {
                HStack {
                    Text("Height")
                    Spacer()
                    Stepper(
                        value: $workspace.progressBarHeight,
                        in: WorkspaceState.progressBarHeightRange,
                        step: 1
                    ) {
                        Text("\(Int(workspace.progressBarHeight)) pt")
                            .font(.system(size: Typography.base, weight: .semibold))
                    }
                }
                HStack {
                    ColorPicker(
                        "Fill",
                        selection: progressColorBinding(
                            $workspace.progressBarFillColor,
                            fallback: workspace.theme.accent
                        ),
                        supportsOpacity: true
                    )
                    Spacer()
                    Button("Use Theme") {
                        workspace.progressBarFillColor = nil
                    }
                }
                HStack {
                    ColorPicker(
                        "Track",
                        selection: progressColorBinding(
                            $workspace.progressBarTrackColor,
                            fallback: workspace.theme.divider.withAlphaComponent(0.35)
                        ),
                        supportsOpacity: true
                    )
                    Spacer()
                    Button("Use Theme") {
                        workspace.progressBarTrackColor = nil
                    }
                }
            }

            Section("Keys") {
                Picker("Option as Meta", selection: $workspace.optionAsMeta) {
                    ForEach(OptionAsMeta.allCases) { option in
                        Text(option.label)
                            .tag(option)
                    }
                }
                .pickerStyle(.segmented)
            }
        }
        .padding(20)
        .frame(width: 520, height: 360)
    }

    private func displayName(for name: String) -> String {
        if let font = NSFont(name: name, size: 12) {
            return font.displayName ?? name
        }
        return name
    }

    private func progressColorBinding(_ color: Binding<NSColor?>, fallback: NSColor) -> Binding<Color> {
        Binding(
            get: { Color(nsColor: color.wrappedValue ?? fallback) },
            set: { newValue in
                let nsColor = NSColor(newValue)
                color.wrappedValue = nsColor.usingColorSpace(.sRGB) ?? nsColor
            }
        )
    }
}
