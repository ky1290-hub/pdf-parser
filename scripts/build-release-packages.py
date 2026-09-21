#!/usr/bin/env python3

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT / "package.json").read_text())["version"]
FIXED_TIME = (2026, 1, 1, 0, 0, 0)


def iter_files(paths):
    for relative in paths:
        source = ROOT / relative
        if source.is_symlink():
            raise RuntimeError(f"symlink is not allowed in a package: {relative}")
        if source.is_dir():
            for child in sorted(source.rglob("*")):
                if child.is_symlink():
                    raise RuntimeError(f"symlink is not allowed in a package: {child.relative_to(ROOT)}")
                if child.is_file():
                    yield child, child.relative_to(ROOT)
        elif source.is_file():
            yield source, relative
        else:
            raise RuntimeError(f"missing package input: {relative}")


def write_zip(destination, mappings):
    seen = set()
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for source, archive_path in mappings:
            name = archive_path.as_posix()
            if name in seen:
                raise RuntimeError(f"duplicate archive entry: {name}")
            seen.add(name)
            info = zipfile.ZipInfo(name, FIXED_TIME)
            mode = 0o755 if os.access(source, os.X_OK) else 0o644
            info.external_attr = (stat.S_IFREG | mode) << 16
            archive.writestr(info, source.read_bytes())


def build(output_dir):
    output_dir.mkdir(parents=True, exist_ok=True)
    shared_docs = [Path(name) for name in ["README.md", "DATA_HANDLING.md", "SECURITY.md", "TERMS.md", "NOTICE.md", "LICENSE"]]
    skill_files = list(iter_files([Path("skills/pdf-parser")]))
    plugin_inputs = [
        Path("plugin.json"),
        Path(".codex-plugin/plugin.json"),
        Path(".claude-plugin/plugin.json"),
        Path("assets/ipe-logo.png"),
        Path("scripts/audit-deliverables.mjs"),
        Path("scripts/inventory-pdfs.mjs"),
        Path("scripts/llamaparse.mjs"),
        *shared_docs,
    ]
    plugin_files = list(iter_files(plugin_inputs)) + skill_files
    plugin_zip = output_dir / f"pdf-parser-plugin-v{VERSION}.zip"
    write_zip(plugin_zip, [(source, Path("pdf-parser") / relative) for source, relative in plugin_files])

    def standalone(include_openai):
        files = []
        for source, relative in skill_files:
            files.append((source, Path("pdf-parser") / relative.relative_to("skills/pdf-parser")))
        for source, relative in iter_files([Path("assets/ipe-logo.png"), *shared_docs]):
            files.append((source, Path("pdf-parser") / relative))
        if include_openai:
            for source, relative in iter_files([Path("agents/openai.yaml")]):
                files.append((source, Path("pdf-parser") / relative))
        return files

    claude_zip = output_dir / f"pdf-parser-claude-v{VERSION}.zip"
    codex_zip = output_dir / f"pdf-parser-codex-v{VERSION}.zip"
    write_zip(claude_zip, standalone(False))
    write_zip(codex_zip, standalone(True))

    archives = [claude_zip, codex_zip, plugin_zip]
    checksums = []
    for archive in archives:
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        checksums.append(f"{digest}  {archive.name}")
        with zipfile.ZipFile(archive) as zipped:
            bad = zipped.testzip()
            if bad:
                raise RuntimeError(f"corrupt archive member: {archive.name}:{bad}")
    (output_dir / "SHA256SUMS").write_text("\n".join(checksums) + "\n")
    return archives


def main():
    parser = argparse.ArgumentParser(description="Build reproducible PDF Parser release ZIPs")
    parser.add_argument("output", nargs="?", help="output directory")
    parser.add_argument("--verify-only", action="store_true", help="build and verify packages in a temporary directory")
    args = parser.parse_args()
    if args.verify_only:
        with tempfile.TemporaryDirectory(prefix="pdf-parser-release-") as directory:
            archives = build(Path(directory))
            print(f"release package verification: {len(archives)} archives passed")
        return
    if not args.output:
        parser.error("output is required unless --verify-only is used")
    archives = build(Path(args.output).resolve())
    for archive in archives:
        print(archive)


if __name__ == "__main__":
    main()
