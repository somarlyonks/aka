# Oradano reference

Background and manual fallbacks for `SKILL.md`.

## Provenance

- Family: **Oradano-mincho-GSRR**, version `0.2018.0101`
- License: Public Domain (per the font's name table)
- Distribution: `OradanoGSRR2018.zip` (7,220,297 bytes) from
  https://www.asahi-net.or.jp/~sd5a-ucd/freefonts/Oradano-Mincho/OradanoGSRR2018.zip
- Local file: `.agents/skills/oradano-font/assets/OradanoGSRR.ttf`, 12,443,532
  bytes — ignored by `.gitignore`, so restore it with the commands in
  `SKILL.md#restore-the-source-font`
- SHA-256: `4a231ea72160844cb0c9d49b35371f682729017ec11b816bbdc97c605ac13c6b`
  (the unpacked TTF; matches both the checked-in subset's source and the zip)
- 12,609 glyphs, 1024 units per em

The source lives inside the skill but outside `public/` because `wrangler.jsonc`
deploys `./public` as Workers Static Assets. Only the subset is meant to be
public. It is also outside git, because nothing in the build reads it at deploy
time and 12 MB of binary would ride along in every clone and push.

## Character source

`assets/gatha.txt` is generated. The build scans `public/**/*.html` for elements
whose class list contains `font-oradano`, adds the `ji: '...'` values from
`src/lib/respond.ts`, drops all whitespace, removes template placeholders such
as `{{JI}}`, and writes the result to the file. Whitespace is dropped because it
cannot be rendered usefully and would add glyphs for spaces and newlines. Other
characters, including punctuation, are kept if present.

If several such elements exist, their text is concatenated in file order and
then document order, followed by the error copy in status order. The combined
list is deduplicated while preserving order; `pyftsubset` only needs the set.

`--text-file` overrides the scan for experiments; in that case the build does
not rewrite `gatha.txt`. A custom `--html-dir` also skips the default `gatha.txt`
rewrite, so pointing the build at test markup never clobbers the checked-in
character list. `--error-copy` points at a different TS file when experimenting.

## Why a subset

The full font is 12 MB and the pages show only a few dozen distinct characters
(the hero gatha plus the error-page `ji` quotes). The subset is ~33 KB and is
preloaded before `style.css` to avoid a flash of fallback text. Compression
drops hinting and all unused glyphs; `font-display: swap` remains as a safety
net.

## Glyph remap

The HTML stays simplified (`lang="zh-Hans"`); only code points the font cannot
render, or ones we deliberately override, are remapped. Oradano-mincho-GSRR has
no glyph for several simplified characters, and its simplified `梦` is overridden
so it uses the traditional-style glyph:

| Simplified | Traditional glyph |
|---|---|
| 为 U+4E3A | 為 U+70BA |
| 梦 U+68A6 | 夢 U+5922 |
| 复 U+590D | 復 U+5FA9 |
| 电 U+7535 | 電 U+96FB |
| 应 U+5E94 | 應 U+61C9 |
| 观 U+89C2 | 觀 U+89C0 |
| 说 U+8BF4 | 説 U+8AAC (the source has no 說) |
| 识 U+8BC6 | 識 U+8B58 |
| 见 U+89C1 | 見 U+898B |
| 树 U+6811 | 樹 U+6A39 |
| 镜 U+955C | 鏡 U+93E1 |
| 净 U+51C0 | 淨 U+6DE8 |
| 诸 U+8BF8 | 諸 U+8AF8 |
| 灭 U+706D | 滅 U+6EC5 |

The table is `REMAP` in `scripts/build.py`. Add an entry when new markup
contains a simplified character whose simplified shape is missing or unwanted.

Some code points are worse than missing: the font maps them to an empty glyph.
`复` U+590D is one — the cmap entry exists, the glyph has zero contours, and a
browser silently draws nothing. The build treats zero-contour glyphs as
unusable, so this fails loudly instead of shipping an invisible character.

The remap must happen on the source font before subsetting; doing it afterwards
would require adding glyphs that the subset already dropped.

## Manual pipeline (without build.py)

```sh
python3 - <<'PY'
from fontTools.ttLib import TTFont

font = TTFont('.agents/skills/oradano-font/assets/OradanoGSRR.ttf')
cmap = font.getBestCmap()

for simplified, traditional in {
    '为': '為',
    '梦': '夢',
    '复': '復',
    '电': '電',
    '应': '應',
    '观': '觀',
}.items():
    glyph = cmap[ord(traditional)]
    for table in font['cmap'].tables:
        if table.isUnicode():
            table.cmap[ord(simplified)] = glyph

font.save('Oradano-remap.ttf')
PY

pyftsubset Oradano-remap.ttf \
  --text="$(cat .agents/skills/oradano-font/assets/gatha.txt)" \
  --no-hinting \
  --output-file=oradano-gatha.ttf

woff2_compress oradano-gatha.ttf

shasum -a 256 oradano-gatha.woff2   # first 8 hex chars become the asset name
```

Then update the `@font-face` `src` and `unicode-range` in `public/style.css` and
the preload href in `public/_templates/index.html`.

## `unicode-range`

The build emits a space-after-comma list of code points (or `U+XXXX-U+YYYY`
runs) taken from the subset's cmap. Keeping it exact matters: browsers skip
downloading the font for characters outside the range, so a missing entry means
a fallback glyph, and an extra entry means a pointless download. It must stay
sorted; the old hand-written list had `U+68A6` out of order.

## Caching

`public/_headers` sets:

```
/_fonts/*
  Cache-Control: public, max-age=31536000, immutable
```

The hashed filename makes that safe. Never reuse a filename for changed bytes,
and never hand-edit the hash; rebuild with `--update-refs`.

## Troubleshooting

- **`ModuleNotFoundError: fontTools`** — run the build with an interpreter that
  has fontTools, e.g. a virtualenv's `bin/python`.
- **`pyftsubset not found`** — put the environment's `bin` on `PATH`; the
  script looks the tool up on `PATH`, not next to the interpreter.
- **`woff2_compress not found`** — `brew install woff2` (or build
  https://github.com/google/woff2).
- **`no element with class 'font-oradano'`** — the markup no longer has that
  class, or `--html-dir` points at the wrong directory.
- **`source font has no usable glyph: ...`** — the character is missing from
  the cmap, or its glyph is empty (zero contours). Add a `REMAP` entry pointing
  at an existing glyph, or change the markup.
- **`error: source font has no glyph for X`** — a `REMAP` target (traditional
  form) is missing from the source; add the glyph or pick another font.
- **Some characters render in a system font** — the character is outside every
  `font-oradano` region, or missing from `unicode-range`; fix the markup and
  rebuild.
- **3.5 MB or larger file in `public/_fonts`** — the full TTF was copied there by
  mistake; only the hashed WOFF2 belongs in `public/_fonts`.
- **Hash changes on every run** — expected: fontTools output is not
  byte-reproducible. The reference update is part of the build.
