import Foundation

enum SkillFrontmatterParser {
    static func parseDocument(from text: String) -> SkillDocument {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard let frontmatterRange = locateFrontmatterRange(in: lines) else {
            return SkillDocument(frontmatter: SkillFrontmatter(name: nil, description: nil, license: nil, metadata: [:], allowedTools: [], argumentHint: nil), body: text)
        }
        let frontmatterLines = Array(lines[frontmatterRange])
        let bodyStartIndex = frontmatterRange.upperBound + 1
        let bodyLines = bodyStartIndex < lines.count ? Array(lines[bodyStartIndex...]) : []
        let body = bodyLines.joined(separator: "\n")
        let parsed = parseFrontmatter(lines: frontmatterLines)
        return SkillDocument(frontmatter: parsed, body: body)
    }

    private static func locateFrontmatterRange(in lines: [String]) -> Range<Int>? {
        guard let firstLine = lines.first else { return nil }
        guard firstLine.trimmingCharacters(in: .whitespacesAndNewlines) == "---" else { return nil }
        if let endIndex = lines.dropFirst().firstIndex(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines) == "---" }) {
            return 1..<endIndex
        }
        return nil
    }

    private static func parseFrontmatter(lines: [String]) -> SkillFrontmatter {
        var name: String?
        var description: String?
        var license: String?
        var metadata: [String: String] = [:]
        var allowedTools: [String] = []
        var argumentHint: String?

        var index = 0
        while index < lines.count {
            let rawLine = lines[index]
            let trimmed = rawLine.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty || trimmed.hasPrefix("#") {
                index += 1
                continue
            }
            let indent = leadingWhitespaceCount(rawLine)
            if let (key, value) = splitKeyValue(trimmed) {
                let lowerKey = key.lowercased()
                if value == "|" || value == ">" {
                    let (text, nextIndex) = parseMultilineValue(lines: lines, startIndex: index + 1, parentIndent: indent)
                    let normalized = value == ">" ? text.replacingOccurrences(of: "\n", with: " ") : text
                    applyScalar(
                        key: lowerKey,
                        value: normalized,
                        name: &name,
                        description: &description,
                        license: &license,
                        argumentHint: &argumentHint
                    )
                    index = nextIndex
                    continue
                }
                if value.isEmpty {
                    if lowerKey == "metadata" {
                        let (parsed, nextIndex) = parseNestedMapping(lines: lines, startIndex: index + 1, parentIndent: indent)
                        metadata.merge(parsed) { _, new in new }
                        index = nextIndex
                        continue
                    }
                    if lowerKey == "allowed-tools" || lowerKey == "allowed_tools" {
                        let (list, nextIndex) = parseList(lines: lines, startIndex: index + 1, parentIndent: indent)
                        allowedTools = list
                        index = nextIndex
                        continue
                    }
                }
                let scalar = parseScalar(value)
                if lowerKey == "allowed-tools" || lowerKey == "allowed_tools" {
                    allowedTools = splitTools(scalar)
                } else {
                    applyScalar(
                        key: lowerKey,
                        value: scalar,
                        name: &name,
                        description: &description,
                        license: &license,
                        argumentHint: &argumentHint
                    )
                }
            }
            index += 1
        }

        return SkillFrontmatter(
            name: name,
            description: description,
            license: license,
            metadata: metadata,
            allowedTools: allowedTools,
            argumentHint: argumentHint
        )
    }

    private static func parseScalar(_ value: String) -> String {
        var output = value.trimmingCharacters(in: .whitespaces)
        if (output.hasPrefix("\"") && output.hasSuffix("\"")) || (output.hasPrefix("'" ) && output.hasSuffix("'")) {
            output = String(output.dropFirst().dropLast())
        }
        return output
    }

    private static func splitKeyValue(_ line: String) -> (String, String)? {
        guard let range = line.range(of: ":") else { return nil }
        let key = line[..<range.lowerBound].trimmingCharacters(in: .whitespaces)
        let value = line[range.upperBound...].trimmingCharacters(in: .whitespaces)
        return (key, value)
    }

    private static func parseNestedMapping(lines: [String], startIndex: Int, parentIndent: Int) -> ([String: String], Int) {
        var result: [String: String] = [:]
        var index = startIndex
        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                index += 1
                continue
            }
            let indent = leadingWhitespaceCount(line)
            if indent <= parentIndent {
                break
            }
            if let (key, value) = splitKeyValue(trimmed) {
                result[key] = parseScalar(value)
            }
            index += 1
        }
        return (result, index)
    }

    private static func parseList(lines: [String], startIndex: Int, parentIndent: Int) -> ([String], Int) {
        var result: [String] = []
        var index = startIndex
        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                index += 1
                continue
            }
            let indent = leadingWhitespaceCount(line)
            if indent <= parentIndent {
                break
            }
            if trimmed.hasPrefix("-") {
                let value = trimmed.dropFirst().trimmingCharacters(in: .whitespaces)
                if !value.isEmpty {
                    result.append(parseScalar(value))
                }
            }
            index += 1
        }
        return (result, index)
    }

    private static func parseMultilineValue(lines: [String], startIndex: Int, parentIndent: Int) -> (String, Int) {
        var collected: [String] = []
        var index = startIndex
        while index < lines.count {
            let line = lines[index]
            let indent = leadingWhitespaceCount(line)
            if indent <= parentIndent {
                break
            }
            let trimmed = line.dropFirst(min(indent, parentIndent + 1))
            collected.append(String(trimmed))
            index += 1
        }
        return (collected.joined(separator: "\n"), index)
    }

    private static func applyScalar(
        key: String,
        value: String,
        name: inout String?,
        description: inout String?,
        license: inout String?,
        argumentHint: inout String?
    ) {
        switch key {
        case "name":
            name = value
        case "description":
            description = value
        case "license":
            license = value
        case "argument-hint", "argument_hint":
            argumentHint = value
        default:
            break
        }
    }

    private static func splitTools(_ value: String) -> [String] {
        let parts = value
            .replacingOccurrences(of: ",", with: " ")
            .split(whereSeparator: { $0.isWhitespace })
            .map(String.init)
        return parts
    }

    private static func leadingWhitespaceCount(_ line: String) -> Int {
        var count = 0
        for scalar in line.unicodeScalars {
            if scalar == " " || scalar == "\t" {
                count += 1
            } else {
                break
            }
        }
        return count
    }
}
