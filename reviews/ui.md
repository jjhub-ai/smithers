Here are the highest‑impact issues I see in this last tranche (Skills + palette/search + diff viewer + scroll/perf). I’m prioritizing **bugs/correctness**, then **security/data integrity**, then **UX/perf**.

---

## 1) CodebaseAnalyzer will miss CI markers (because you skip hidden files)

In `CodebaseAnalyzer.scanMarkers` you enumerate with:

```swift
options: [.skipsHiddenFiles, .skipsPackageDescendants]
```

That **prevents you from ever seeing**:

- `.github/` (so your “hasCI” detection via workflows never triggers)
- `.gitlab-ci.yml` (also hidden)
- any other dotfile CI config

You even have:

```swift
if name == ".github" {
   ...
}
```

…but that branch is dead because `.skipsHiddenFiles` filters it out.

### Fix

Either **remove** `.skipsHiddenFiles` entirely, or keep it and **explicitly check** for the hidden markers up-front.

Minimal change:

```swift
let options: FileManager.DirectoryEnumerationOptions = [.skipsPackageDescendants] // remove skipsHiddenFiles
```

Or keep hidden skipping and add direct checks before enumerating:

```swift
let fm = FileManager.default
if fm.fileExists(atPath: rootDirectory.appendingPathComponent(".github/workflows").path) { markers.hasCI = true }
if fm.fileExists(atPath: rootDirectory.appendingPathComponent(".gitlab-ci.yml").path) { markers.hasCI = true }
```

---

## 2) SkillInstaller: URL normalization is wrong for “github.com/org/repo” and you have CLI option injection risk

### A) `normalizeGitURL(_:)` breaks common input

Currently:

```swift
if source.contains("/") {
    let normalized = source.hasSuffix(".git") ? source : "\(source).git"
    return "https://github.com/\(normalized)"
}
```

If the user types `github.com/org/repo`, this becomes:

```
https://github.com/github.com/org/repo.git   // wrong
```

### B) `git clone` argument injection

You pass the repo URL as an argument:

```swift
process.arguments = ["git", "clone", "--depth", "1", repoURL, destination.path]
```

If a user enters a repo string starting with `-` (e.g. `--config=...`), Git will treat it as an option. Git supports `--` to terminate options. You should use it.

### Fix (both)

- Make normalization detect “github.com/…” with no scheme.
- Add `--` in the git clone invocation.

Example normalization that handles:

- `https://github.com/org/repo`
- `github.com/org/repo`
- `org/repo`
- `git@github.com:org/repo.git`
- anything else left as-is

```swift
private func normalizeGitURL(_ source: String) -> String {
    let trimmed = source.trimmingCharacters(in: .whitespacesAndNewlines)

    if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") ||
       trimmed.hasPrefix("ssh://")  || trimmed.hasPrefix("git@") ||
       trimmed.hasPrefix("file://") {
        return trimmed
    }

    if trimmed.hasPrefix("github.com/") {
        let rest = String(trimmed.dropFirst("github.com/".count))
        let repo = rest.hasSuffix(".git") ? rest : "\(rest).git"
        return "https://github.com/\(repo)"
    }

    // owner/repo
    let parts = trimmed.split(separator: "/")
    if parts.count == 2 {
        let repo = trimmed.hasSuffix(".git") ? trimmed : "\(trimmed).git"
        return "https://github.com/\(repo)"
    }

    return trimmed
}
```

And in `cloneRepo`:

```swift
process.arguments = ["git", "clone", "--depth", "1", "--", repoURL, destination.path]
```

---

## 3) SkillRegistryClient / SkillRegistryDetailView: GitHub repo parsing is too permissive (breaks on URLs with extra path)

Both `normalizeGitHubRepo(_:)` implementations do:

```swift
let trimmed = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
return trimmed
```

If `source` is a URL like:

- `https://github.com/org/repo/tree/main`
- `https://github.com/org/repo/`

You’ll return:

- `org/repo/tree/main` (invalid for raw URLs and `/repos/{repo}` API)

### Fix

When parsing a GitHub URL, only keep the **first two path components**:

```swift
private func normalizeGitHubRepo(_ source: String) -> String? {
    let trimmed = source.trimmingCharacters(in: .whitespacesAndNewlines)

    func ownerRepo(from path: String) -> String? {
        let parts = path.split(separator: "/").filter { !$0.isEmpty }
        guard parts.count >= 2 else { return nil }
        return "\(parts[0])/\(parts[1])"
    }

    if trimmed.contains("github.com") {
        let urlString = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
        guard let url = URL(string: urlString) else { return nil }
        return ownerRepo(from: url.path)
    }

    return ownerRepo(from: trimmed)
}
```

---

## 4) DiffViewer.swift likely needs `import AppKit` (and your NSColor blending call is suspicious)

`DiffViewer.swift` imports only `SwiftUI`, but `DiffTheme` uses `NSColor`:

```swift
private var addTint: NSColor { NSColor.systemGreen }
```

That requires `import AppKit` in that file (unless you’re relying on some `@_exported import AppKit` elsewhere, which is brittle).

Also this line:

```swift
baseBackground.blended(with: tint, fraction: strength)
```

is **not** the standard AppKit API signature. Standard is:

```swift
baseBackground.blended(withFraction: strength, of: tint)
```

and it returns an optional.

### Fix

At minimum, add:

```swift
import AppKit
```

and if you don’t have your own extension:

```swift
private func tintBackground(_ tint: NSColor, strength: CGFloat) -> NSColor {
    baseBackground.blended(withFraction: strength, of: tint) ?? baseBackground
}
```

Same for `tintText`.

---

## 5) PerformanceMonitor: publishing from background threads is likely (and will trip SwiftUI warnings)

`PerformanceMonitor` is not `@MainActor`, but it mutates `@Published` properties from methods like:

- `recordRender(duration:)`
- `recordHighlight(duration:)`
- cache hit/miss counters

If any of those are called off the main thread (common if rendering/highlighting happens on background queues), you’ll get:

- runtime warnings (“Publishing changes from background threads…”)
- potential data races on `SampleBuffer`

### Fix options

**Best for correctness:** make the entire monitor MainActor isolated:

```swift
@MainActor
final class PerformanceMonitor: ObservableObject { ... }
```

Then callers from background must hop to main (compile-time enforced).

If you can’t guarantee main calls, the “low overhead” approach is:

- keep internal counters locked/atomic
- publish a sampled snapshot on a timer on main

Given this is DEBUG tooling, simplest is typically `@MainActor`.

Also: `updateActiveState()` resets fps/frame/render/highlight but **does not reset** `glyphCacheHits/misses`. If you expect “fresh session” behavior when enabling, reset those too.

---

## 6) SkillInstallStore is not concurrency-safe (easy file corruption / races)

`SkillInstallStore` is a shared singleton with:

- a mutable `records` dictionary
- `persist()` writing JSON to disk
- no locking / actor isolation

At the same time:

- installs/upgrades call `upsert()`
- scanning calls `record(for:)`
- UI could call remove/update concurrently

This is a classic race leading to:

- lost updates
- corrupted JSON (rare but real)
- inconsistent UI state

### Fix

Either:

- make it an `actor`, or
- add a lock/serial queue around `records` and `persist()`.

Given you already use `NSLock` elsewhere, a lock is minimal impact:

```swift
private let lock = NSLock()

func record(for path: URL) -> SkillInstallRecord? {
    lock.lock(); defer { lock.unlock() }
    return records[path.standardizedFileURL.path]
}

func upsert(record: SkillInstallRecord) {
    lock.lock()
    records[record.path] = record
    lock.unlock()
    persist()
}
```

If you lock, also lock inside `persist()` around reads of `records`.

---

## 7) Skill installation is synchronous and will freeze UI (git clone + file copy)

`SkillInstaller.install(...) throws -> SkillInstallResult` does:

- `git clone` (blocking `readDataToEndOfFile()` + `waitUntilExit()`)
- file enumeration / copy

If invoked from SwiftUI button handlers on the main actor, this will produce noticeable UI stalls.

### Fix

Make install async and run blocking work off-main:

- `func install(...) async throws -> SkillInstallResult`
- `cloneRepo` via `Task.detached` or (better) an async Process wrapper
- allow cancellation (Task cancellation should stop the clone and cleanup)

Even if you don’t go full async process management, at least wrap the current synchronous install call in a background Task at the call site and only hop to main to update UI.

---

## 8) SkillTemplateBuilder generates YAML that can break on quotes/newlines

You generate:

```swift
frontmatter.append("name: \(name)")
frontmatter.append("description: \"\(description)\"")
```

Problems:

- `name` is unquoted → YAML breaks on `:` `#` leading/trailing spaces, etc.
- `description` is quoted but you **don’t escape** `"` or `\`
- multiline descriptions become invalid

### Fix

Add a YAML-safe quoting helper:

```swift
private static func yamlQuote(_ s: String) -> String {
    let escaped = s
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
    return "\"\(escaped)\""
}
```

Then:

```swift
frontmatter.append("name: \(yamlQuote(name))")
frontmatter.append("description: \(yamlQuote(description))")
```

If you want multiline support, output `description: |` and indent body lines.

---

## 9) SkillFrontmatterParser multiline indentation trimming is off

`parseMultilineValue` strips only `parentIndent + 1` characters (because of `min(indent, parentIndent + 1)`), which leaves unwanted leading spaces for common YAML indentation (2 spaces).

This will produce odd leading whitespace in multiline descriptions/argument hints.

If you keep this homegrown YAML subset, a better approach is:

- compute the minimum indent of non-empty block lines (> parentIndent)
- strip that baseline from all block lines

---

## 10) Registry client: concurrency and ratePS/Rate limiting are likely to bite

`SkillRegistryClient.search()` can, per query:

- fetch `/api/search`
- then for up to 20 results:

  - try up to 4 raw.githubusercontent.com URLs each
  - hit GitHub `/repos/{repo}`

That’s **a lot** of requests, and you do it concurrently via `TaskGroup`. You will hit:

- GitHub unauthenticated rate limits
- transient failures with no useful UI error

### Fixes

- Add **concurrency limiting** (e.g., only 4–6 in flight)
- Cache repo info per repo (stars/license/updatedAt)
- Set `User-Agent` header for GitHub API requests (recommended)
- Use default branch from repo info (include `default_branch` in response) to reduce “main/master” probing

---

## Small but worth noting

- `SkillBrowserView.performSearch` can still show stale results if cancellation doesn’t stop `workspace.searchRegistry`. You should gate results by a request token (compare query or UUID before assigning `results`).
- `CommandPalettePanel.updatePreview` cancels `previewTask`, but the inner `Task.detached` will still run. Guard before assigning `previewText` that the selection/path still matches.
- `SkillItem.id` uses `path.path` (not standardized/resolved). If you want stable identity across symlinks/relative paths, prefer `path.standardizedFileURL.path`.

---

If you want, paste the `WorkspaceState` pieces that glue skills (install/update/remove/move, registry search) into UI state; most of the remaining real risk will be there (MainActor vs background, cancellation, and file operations).
