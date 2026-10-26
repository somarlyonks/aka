---
name: oradano-font
description: Rebuild or debug the Oradano-mincho-GSRR WOFF2 subset used by aka's hero gatha and error-page ji copy, including the simplified-to-traditional glyph remap. Use when changing the gatha text or hero markup, updating the source font, adjusting the @font-face unicode-range or preload, or investigating why CJK characters in the index page fall back to system fonts.
disable-model-invocation: true
---

# Oradano font pipeline

The index page renders the diamond-sutra gatha, and error pages render a
`STATUS_MAP` ji quote, with a small WOFF2 subset of Oradano-mincho-GSRR. The
index markup and the `ji` values are the source of truth; the build collects
both.

## Files

| Path | Role |
|---|---|
| `.agents/skills/oradano-font/assets/OradanoGSRR.ttf` | Source font, 12 MB, public domain, not deployed, **not in git** (see the section below) |
| `.agents/skills/oradano-font/assets/gatha.txt` | **Generated** character list; do not edit |
| `.agents/skills/oradano-font/scripts/build.py` | Collect chars, remap, subset, hash, update references |
| `public/_templates/index.html` | Gatha markup: elements with class `font-oradano` |
| `src/lib/respond.ts` | `STATUS_MAP` `ji: '...'` copy rendered on error pages |
| `public/_fonts/oradano-gatha.<hash>.woff2` | Generated asset, served with immutable caching |
| `public/style.css` | `@font-face` URL and `unicode-range` |

## Restore the source font

`assets/OradanoGSRR.ttf` is ignored by git: 12 MB of public-domain font would
weigh on every clone and push. A fresh checkout must fetch it from the upstream
distribution before the build can run:

```sh
curl -LO https://www.asahi-net.or.jp/~sd5a-ucd/freefonts/Oradano-Mincho/OradanoGSRR2018.zip
unzip -o OradanoGSRR2018.zip OradanoGSRR.ttf -d .agents/skills/oradano-font/assets
shasum -a 256 .agents/skills/oradano-font/assets/OradanoGSRR.ttf
```

The hash must be `4a231ea72160844cb0c9d49b35371f682729017ec11b816bbdc97c605ac13c6b`.
The archive holds `OradanoGSRR.ttf` at its root, so the command drops it straight
into `assets/`. Without the file the build stops with `source font not found`.
Provenance and the release notes are in `references/oradano.md#provenance`.

## Run the build

Dependencies: Python 3.9+, `fonttools` + `brotli` (for `pyftsubset`), and
`woff2_compress` from Google's woff2 tools. On macOS:

```sh
python3 -m pip install fonttools brotli
brew install woff2

python3 .agents/skills/oradano-font/scripts/build.py --update-refs
```

If fontTools is installed in a virtualenv, run that interpreter with the
virtualenv's `bin` on `PATH`, because the script shells out to `pyftsubset`:

```sh
/path/to/venv/bin/python .agents/skills/oradano-font/scripts/build.py --update-refs
```

Options: `--source`, `--html-dir`, `--error-copy`, `--text-file`, `--out-dir`, `--update-refs`.
Without `--update-refs` the asset is written but `style.css` and `index.html`
still point at the old name.

## What the build does

1. Scans `public/**/*.html` for elements whose class list contains
   `font-oradano`, adds the `ji: '...'` strings from `src/lib/respond.ts`, strips
   template placeholders such as `{{JI}}`, drops whitespace and duplicates, and
   writes `assets/gatha.txt`. If no such element exists, the build stops.
2. Remaps the simplified code points that need traditional glyph shapes (see
   `references/oradano.md#glyph-remap`).
3. Runs `pyftsubset --no-hinting` with the collected characters, then verifies
   that every one has a real glyph in the subset.
4. Runs `woff2_compress`.
5. Names the result `oradano-gatha.<sha256[:8]>.woff2`, copies it to
   `public/_fonts/`, removes stale `oradano-gatha.*.woff2` files, and with
   `--update-refs` rewrites the `@font-face` URL, `unicode-range`, and preload
   href.

The content hash can change between runs or fontTools versions even with the
same input; `--update-refs` keeps the references consistent. Never rename the
asset by hand.

## Change the gatha or error copy

1. Edit `public/_templates/index.html` for the hero gatha, or the `ji` values in
   `src/lib/respond.ts` for error pages. Do not edit `gatha.txt`; it is
   regenerated.
2. If a newly added character has no glyph, or maps to an empty glyph (as `复`
   does), add it to the `REMAP` table (see `references/oradano.md#glyph-remap`).
   The build fails with `source font has no usable glyph: ...` otherwise.
3. Rebuild with `--update-refs`.
4. Verify the `unicode-range` in `style.css` lists exactly the new set.

## Verify

```sh
ls public/_fonts                                    # one hashed woff2 + README
grep oradano-gatha public/style.css public/_templates/index.html
```

The build already asserts glyph coverage; `references/oradano.md` has a manual
check and troubleshooting.

Provenance, remap rationale, manual commands, `unicode-range`, caching, and
troubleshooting live in `references/oradano.md`.
