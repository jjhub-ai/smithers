#!/usr/bin/env python3
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROJECT_YML = ROOT / "apps/desktop/project.yml"
PACKAGE_SWIFT = ROOT / "apps/desktop/Package.swift"


def parse_package_swift(text: str) -> dict[str, str]:
    pattern = re.compile(
        r"\.package\(\s*url:\s*\"([^\"]+)\"\s*,\s*(from|exact|branch):\s*\"([^\"]+)\"\s*\)",
        re.MULTILINE,
    )
    packages: dict[str, str] = {}
    for url, kind, value in pattern.findall(text):
        packages[url] = f"{kind}:{value}"
    return packages


def parse_project_yml(text: str) -> dict[str, str]:
    packages: dict[str, dict[str, str]] = {}
    in_packages = False
    current_name: str | None = None
    current: dict[str, str] = {}

    for line in text.splitlines():
        if line.startswith("packages:"):
            in_packages = True
            continue
        if in_packages:
            if re.match(r"^\S", line):
                if current_name:
                    packages[current_name] = current
                break
            name_match = re.match(r"^  ([^:]+):\s*$", line)
            if name_match:
                if current_name:
                    packages[current_name] = current
                current_name = name_match.group(1)
                current = {}
                continue
            field_match = re.match(r"^    (url|from|exactVersion|branch):\s*(.+)$", line)
            if field_match and current_name:
                key, value = field_match.groups()
                packages.setdefault(current_name, current)
                current[key] = value.strip().strip('"')

    if current_name:
        packages[current_name] = current

    result: dict[str, str] = {}
    for data in packages.values():
        url = data.get("url")
        if not url:
            continue
        if "from" in data:
            spec = f"from:{data['from']}"
        elif "exactVersion" in data:
            spec = f"exact:{data['exactVersion']}"
        elif "branch" in data:
            spec = f"branch:{data['branch']}"
        else:
            spec = "unspecified"
        result[url] = spec
    return result


def main() -> int:
    if not PROJECT_YML.exists():
        print(f"Missing {PROJECT_YML}")
        return 1
    if not PACKAGE_SWIFT.exists():
        print(f"Missing {PACKAGE_SWIFT}")
        return 1

    project_packages = parse_project_yml(PROJECT_YML.read_text())
    swift_packages = parse_package_swift(PACKAGE_SWIFT.read_text())

    missing_in_swift = sorted(set(project_packages) - set(swift_packages))
    missing_in_project = sorted(set(swift_packages) - set(project_packages))
    mismatched: list[str] = []

    for url in sorted(set(project_packages) & set(swift_packages)):
        if project_packages[url] != swift_packages[url]:
            mismatched.append(
                f"{url} project.yml={project_packages[url]} Package.swift={swift_packages[url]}"
            )

    if missing_in_swift or missing_in_project or mismatched:
        print("Desktop package definitions are out of sync:")
        if missing_in_swift:
            print("- Missing in Package.swift:")
            for url in missing_in_swift:
                print(f"  - {url} ({project_packages[url]})")
        if missing_in_project:
            print("- Missing in project.yml:")
            for url in missing_in_project:
                print(f"  - {url} ({swift_packages[url]})")
        if mismatched:
            print("- Version mismatch:")
            for entry in mismatched:
                print(f"  - {entry}")
        return 1

    print("Desktop package dependencies are in sync.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
