# Fonts

`oradano-gatha.<hash>.woff2` is a WOFF2 subset of **Oradano-mincho-GSRR**(Public Domain), containing the glyphs used by the hero gatha and the `STATUS_MAP` `ji` copy on error pages. Simplified code points that the font cannot render are remapped to available traditional or Japanese glyphs at build time.

The 12 MB source font is **not** deployed and **not** in git; restore it from the upstream zip as described in `.agents/skills/oradano-font/SKILL.md`.

Rebuild with the `oradano-font` skill:

```sh
python3 .agents/skills/oradano-font/scripts/build.py --update-refs
```

The skill collects characters from `public/_templates/index.html` (class `font-oradano`) and the `ji: '...'` values in `src/lib/respond.ts`, so `assets/gatha.txt` is generated. Do not rename the hashed asset by hand; the build updates the `@font-face` URL and preload link. Workflow and details: `.agents/skills/oradano-font/SKILL.md` and `references/oradano.md`.
