#!/usr/bin/env python3
"""Subset the Material Symbols Outlined icon font to the glyphs this app uses.

Reads the ligature names listed in scripts/material-symbols-list.txt, subsets
node_modules/material-symbols/material-symbols-outlined.woff2 down to those
ligatures, and writes public/fonts/material-symbols-outlined.woff2.

After writing, the output font is re-parsed and every requested ligature is
verified to still resolve through GSUB — the script exits non-zero (and removes
the output) if any icon was lost, so a broken subset can never ship silently.

Requirements: Python with fonttools and brotli (`pip install fonttools brotli`).

When adding a new icon to the UI:
  1. add its ligature name to scripts/material-symbols-list.txt
  2. run `npm run icons:subset`
"""
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
SRC_FONT = ROOT / "node_modules" / "material-symbols" / "material-symbols-outlined.woff2"
ICON_LIST = ROOT / "scripts" / "material-symbols-list.txt"
OUT_FONT = ROOT / "public" / "fonts" / "material-symbols-outlined.woff2"


def ligature_map(font):
    """Map each ligature string the font's GSUB table can produce to its glyph."""
    cmap = font.getBestCmap()
    rev = {v: k for k, v in cmap.items()}
    names = {}
    for lookup in font["GSUB"].table.LookupList.Lookup:
        for st in lookup.SubTable:
            if hasattr(st, "ExtSubTable"):
                st = st.ExtSubTable
            if not hasattr(st, "ligatures"):
                continue
            for first, ligs in st.ligatures.items():
                for lig in ligs:
                    try:
                        name = "".join(chr(rev[g]) for g in [first] + lig.Component)
                    except KeyError:
                        continue
                    names.setdefault(name, lig.LigGlyph)
    return names


def prune_ligatures(font, wanted_names):
    """Delete GSUB ligature entries not in wanted_names, in place.

    Must run BEFORE subsetting: with the entries gone, glyph closure can only
    ever reach the wanted ligature glyphs, so the subsetter keeps the glyph set
    minimal. Pruning after the fact does not work — the extra glyphs would
    already have been pulled into the subset by closure.
    """
    keep = set(wanted_names)
    removed = 0
    for lookup in font["GSUB"].table.LookupList.Lookup:
        for st in lookup.SubTable:
            if hasattr(st, "ExtSubTable"):
                st = st.ExtSubTable
            if not hasattr(st, "ligatures"):
                continue
            cmap = font.getBestCmap()
            rev = {v: k for k, v in cmap.items()}
            for first in list(st.ligatures.keys()):
                kept = []
                for lig in st.ligatures[first]:
                    try:
                        name = "".join(chr(rev[g]) for g in [first] + lig.Component)
                    except KeyError:
                        name = None
                    if name in keep:
                        kept.append(lig)
                    else:
                        removed += 1
                if kept:
                    st.ligatures[first] = kept
                else:
                    del st.ligatures[first]
    return removed


def main():
    names = [n.strip() for n in ICON_LIST.read_text(encoding="utf-8").splitlines() if n.strip()]
    if not names:
        sys.exit("icon list is empty")

    src = TTFont(SRC_FONT)
    available = ligature_map(src)
    missing = [n for n in names if n not in available]
    if missing:
        sys.exit(f"requested icons missing from source font: {missing}")

    prune_ligatures(src, names)

    letters = {g for n in names for g in n}
    glyphs = {available[n] for n in names}
    cmap = src.getBestCmap()
    glyph_set = set(glyphs)
    for ch in letters:
        g = cmap.get(ord(ch))
        if g:
            glyph_set.add(g)

    opts = subset.Options()
    opts.flavor = "woff2"
    # Material Symbols exposes its icon ligatures under `rlig` (required
    # ligatures), not `liga` — excluding it drops every ligature lookup.
    opts.layout_features = ["rlig", "liga", "rclt"]
    subsetter = subset.Subsetter(options=opts)
    subsetter.populate(glyphs=glyph_set)
    subsetter.subset(src)

    OUT_FONT.parent.mkdir(parents=True, exist_ok=True)
    src.save(OUT_FONT)

    out = TTFont(OUT_FONT)
    kept = ligature_map(out)
    lost = [n for n in names if n not in kept]
    if lost:
        OUT_FONT.unlink(missing_ok=True)
        sys.exit(f"ligatures lost during subsetting: {lost}")

    print(f"{SRC_FONT.stat().st_size / 1024:.0f} KB -> {OUT_FONT.stat().st_size / 1024:.0f} KB for {len(names)} icons")


if __name__ == "__main__":
    main()
