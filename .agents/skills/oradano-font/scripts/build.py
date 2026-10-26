#!/usr/bin/env python3
"""Rebuild the Oradano subset WOFF2 used by the aka hero gatha and error ji copy.

Pipeline: collect chars from class="font-oradano" HTML and STATUS_MAP ji copy ->
simplified/traditional cmap remap -> pyftsubset (--no-hinting) -> woff2_compress
-> content-hashed filename under public/_fonts.

Requires fontTools + brotli (for pyftsubset) and woff2_compress on PATH.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import shutil
import subprocess
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path

from fontTools.ttLib import TTFont

# The source font has no simplified forms for these characters, so each
# simplified code point is pointed at the glyph for its traditional form.
# The HTML keeps the simplified text; only the rendered shapes are traditional.
REMAP = {
    "为": "為",
    "梦": "夢",
    "复": "復",
    "电": "電",
    "应": "應",
    "观": "觀",
    "说": "説",
    "识": "識",
    "见": "見",
    "树": "樹",
    "镜": "鏡",
    "净": "淨",
    "诸": "諸",
    "灭": "滅",
}

SKILL_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = SKILL_DIR.parents[2]

DEFAULT_SOURCE = SKILL_DIR / "assets" / "OradanoGSRR.ttf"
DEFAULT_TEXT = SKILL_DIR / "assets" / "gatha.txt"
DEFAULT_HTML_DIR = REPO_ROOT / "public"
DEFAULT_OUT_DIR = REPO_ROOT / "public" / "_fonts"
STYLE_CSS = REPO_ROOT / "public" / "style.css"
INDEX_HTML = REPO_ROOT / "public" / "_templates" / "index.html"
DEFAULT_ERROR_COPY = REPO_ROOT / "src" / "lib" / "respond.ts"
FONT_CLASS = "font-oradano"
JI_RE = re.compile(r"\bji:\s*'([^']*)'")
PLACEHOLDER_RE = re.compile(r"\{\{[^{}]*\}\}")

VOID_TAGS = {
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
}


def fail(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


def require_tool(name: str, hint: str) -> None:
    if shutil.which(name) is None:
        fail(f"{name} not found on PATH. {hint}")


class FontTextParser(HTMLParser):
    """Collect text inside elements whose class list contains FONT_CLASS."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.skip_depth = 0
        self.matched = False
        self.chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.depth:
            if tag in VOID_TAGS:
                return
            self.depth += 1
            if tag in ("script", "style"):
                self.skip_depth += 1
            return
        classes = (dict(attrs).get("class") or "").split()
        if FONT_CLASS in classes:
            self.matched = True
            self.depth = 1

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        # A self-closing element contributes no text; only its class matters at
        # the top level, where an empty region is still a match.
        if not self.depth:
            classes = (dict(attrs).get("class") or "").split()
            if FONT_CLASS in classes:
                self.matched = True

    def handle_endtag(self, tag: str) -> None:
        if not self.depth or tag in VOID_TAGS:
            return
        if tag in ("script", "style") and self.skip_depth:
            self.skip_depth -= 1
        self.depth -= 1

    def handle_data(self, data: str) -> None:
        if self.depth and not self.skip_depth:
            self.chunks.append(data)

    def text(self) -> str:
        return "".join(self.chunks)


def collect_chars(html_dir: Path) -> str:
    """Return the non-whitespace text inside FONT_CLASS regions, in order."""
    if not html_dir.is_dir():
        fail(f"HTML directory not found: {html_dir}")

    chars: list[str] = []
    matched = False

    for path in sorted(html_dir.rglob("*.html")):
        parser = FontTextParser()
        parser.feed(path.read_text(encoding="utf-8"))
        parser.close()
        if not parser.matched:
            continue
        matched = True
        text = PLACEHOLDER_RE.sub("", parser.text())
        chars.extend(ch for ch in text if not ch.isspace())

    if not matched:
        fail(f"no element with class '{FONT_CLASS}' found under {html_dir}")
    if not chars:
        fail(f"elements with class '{FONT_CLASS}' contain no text")
    return "".join(chars)


def collect_error_copy(path: Path) -> str:
    """Return the non-whitespace ji copy from the error status map."""
    if not path.is_file():
        fail(f"error copy file not found: {path}")

    values = JI_RE.findall(path.read_text(encoding="utf-8"))
    if not values:
        fail(f"no ji entries found in {path}")
    return "".join(ch for value in values for ch in value if not ch.isspace())


def write_gatha(path: Path, text: str) -> None:
    content = text + "\n"
    if path.is_file() and path.read_text(encoding="utf-8") == content:
        return
    path.write_text(content, encoding="utf-8")
    print(f"updated {path.relative_to(REPO_ROOT)}")


def remap(font_path: Path, out_path: Path) -> None:
    font = TTFont(font_path)
    cmap = font.getBestCmap()

    overridden = []
    for simplified, traditional in REMAP.items():
        if ord(traditional) not in cmap:
            fail(f"source font has no glyph for {traditional} (U+{ord(traditional):04X})")
        if ord(simplified) in cmap:
            overridden.append(simplified)
    if overridden:
        print(f"note: overriding existing simplified glyphs for {''.join(overridden)}")

    for simplified, traditional in REMAP.items():
        glyph = cmap[ord(traditional)]
        for table in font["cmap"].tables:
            if table.isUnicode():
                table.cmap[ord(simplified)] = glyph

    font.save(out_path)


def unicode_range(font_path: Path) -> str:
    font = TTFont(font_path)
    codepoints = sorted(font.getBestCmap())

    ranges: list[tuple[int, int]] = []
    for cp in codepoints:
        if ranges and cp == ranges[-1][1] + 1:
            ranges[-1] = (ranges[-1][0], cp)
        else:
            ranges.append((cp, cp))

    parts = [
        f"U+{start:X}" if start == end else f"U+{start:X}-{end:X}"
        for start, end in ranges
    ]
    return ", ".join(parts)


def subset(source: Path, text: str, out_dir: Path) -> tuple[Path, Path]:
    pyftsubset = shutil.which("pyftsubset")
    if pyftsubset is None:
        fail("pyftsubset not found on PATH. Install fontTools (pip install fonttools brotli).")
    require_tool(
        "woff2_compress",
        "Install it with `brew install woff2` (or build from https://github.com/google/woff2).",
    )

    remapped = out_dir / "Oradano-remap.ttf"
    remap(source, remapped)

    text_file = out_dir / "gatha.txt"
    text_file.write_text(text, encoding="utf-8")

    subset_ttf = out_dir / "oradano-gatha.ttf"
    subprocess.run(
        [
            pyftsubset,
            str(remapped),
            f"--text-file={text_file}",
            "--no-hinting",
            f"--output-file={subset_ttf}",
        ],
        check=True,
    )

    subprocess.run(["woff2_compress", subset_ttf.name], cwd=out_dir, check=True)
    woff2 = subset_ttf.with_suffix(".woff2")
    if not woff2.exists():
        fail(f"woff2_compress did not produce {woff2.name}")
    verify_subset(subset_ttf, text)
    return subset_ttf, woff2


def verify_subset(font_path: Path, text: str) -> None:
    font = TTFont(font_path)
    cmap = font.getBestCmap()
    glyf = font["glyf"]

    missing: list[str] = []
    empty: list[str] = []
    for ch in text:
        if ch.isspace():
            continue
        glyph = cmap.get(ord(ch))
        if glyph is None or glyph == ".notdef":
            missing.append(ch)
        elif glyf[glyph].numberOfContours == 0:
            empty.append(ch)

    if missing or empty:
        details = []
        if missing:
            details.append(f"no mapping for {''.join(missing)}")
        if empty:
            details.append(f"empty glyph for {''.join(empty)}")
        fail(
            "source font has no usable glyph: "
            + "; ".join(details)
            + "; add a remap in REMAP or change the markup"
        )


def sha8(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:8]


def copy_asset(woff2: Path, out_dir: Path) -> Path:
    name = f"oradano-gatha.{sha8(woff2)}.woff2"
    target = out_dir / name
    shutil.copyfile(woff2, target)

    for stale in out_dir.glob("oradano-gatha.*.woff2"):
        if stale.name != name:
            stale.unlink()
            try:
                shown = stale.relative_to(REPO_ROOT)
            except ValueError:
                shown = stale
            print(f"removed stale {shown}")
    return target


def update_refs(asset: Path, ranges: str) -> None:
    url = f"/_fonts/{asset.name}"

    css = STYLE_CSS.read_text(encoding="utf-8")
    css = re.sub(
        r'(src:\s*url\("/_fonts/oradano-gatha[^"]*"\))',
        f'src: url("{url}")',
        css,
        count=1,
    )
    css = re.sub(
        r"(unicode-range:)[^;]*;",
        f"\\1 {ranges};",
        css,
        count=1,
    )
    STYLE_CSS.write_text(css, encoding="utf-8")
    print(f"updated {STYLE_CSS.relative_to(REPO_ROOT)}")

    html = INDEX_HTML.read_text(encoding="utf-8")
    html = re.sub(
        r'(href="/_fonts/oradano-gatha[^"]*")',
        f'href="{url}"',
        html,
        count=1,
    )
    INDEX_HTML.write_text(html, encoding="utf-8")
    print(f"updated {INDEX_HTML.relative_to(REPO_ROOT)}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="source TTF")
    parser.add_argument(
        "--html-dir",
        type=Path,
        default=DEFAULT_HTML_DIR,
        help=f"scan HTML here for class '{FONT_CLASS}' (default: public/)",
    )
    parser.add_argument(
        "--text-file",
        type=Path,
        default=None,
        help="use a fixed character list instead of scanning HTML",
    )
    parser.add_argument(
        "--error-copy",
        type=Path,
        default=DEFAULT_ERROR_COPY,
        help="TS file with ji: '...' error copy (default: src/lib/respond.ts)",
    )
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR, help="asset output dir")
    parser.add_argument(
        "--update-refs",
        action="store_true",
        help="rewrite the @font-face URL/unicode-range and the <link rel=preload>",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source = args.source.expanduser().resolve()
    html_dir = args.html_dir.expanduser().resolve()
    error_copy = args.error_copy.expanduser().resolve()
    out_dir = args.out_dir.resolve()

    if not source.is_file():
        fail(
            f"source font not found: {source} "
            "(download it, see .agents/skills/oradano-font/SKILL.md)",
        )

    if args.text_file is not None:
        text_file = args.text_file.expanduser().resolve()
        if not text_file.is_file():
            fail(f"text file not found: {text_file}")
        text = "".join(ch for ch in text_file.read_text(encoding="utf-8") if not ch.isspace())
    else:
        text = collect_chars(html_dir) + collect_error_copy(error_copy)
        text = "".join(dict.fromkeys(text))

    if not text:
        fail("no characters to subset")

    out_dir.mkdir(parents=True, exist_ok=True)
    if args.update_refs and out_dir != DEFAULT_OUT_DIR:
        fail("--update-refs only makes sense with the default --out-dir (public/_fonts)")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        subset_ttf, woff2 = subset(source, text, work)
        ranges = unicode_range(subset_ttf)
        asset = copy_asset(woff2, out_dir)

    if args.text_file is None and html_dir == DEFAULT_HTML_DIR.resolve():
        write_gatha(DEFAULT_TEXT, text)

    try:
        shown = asset.relative_to(REPO_ROOT)
    except ValueError:
        shown = asset
    print(f"built {shown} ({asset.stat().st_size} bytes)")
    print(f"chars: {text}")
    print(f"unicode-range: {ranges}")

    if args.update_refs:
        update_refs(asset, ranges)
    else:
        print('run again with --update-refs (or update public/style.css and public/_templates/index.html manually)')


if __name__ == "__main__":
    main()
