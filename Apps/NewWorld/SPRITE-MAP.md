# New World sprite map

The SVG remains the selectable strategic map. At zoom 1.65 the map cross-fades to an isometric district view. Each selected State receives a deterministic 28 × 28 district layout with roads, avenues, a river, parks, trees and sprite buildings.

## Sprite-sheet format

The private source PNGs are 8 × 4 sheets containing 32 directional views of one building. The builder extracts four cardinal views (frames 0, 8, 16 and 24) per source sheet, then packs them into browser atlas pages. The current set produces 588 directional sprites from 147 source sheets.

## Build the runtime atlas

1. Clone the private `belfegor442/NewWorld-Assets` repository next to the main repository.
2. Install Pillow if it is not already installed: `python -m pip install Pillow`.
3. From the main repository root run:

```powershell
python .\Apps\NewWorld\build-spritesheet.py --asset-root ..\NewWorld-Assets
```

This generates `docs/Apps/NewWorld/assets/spritesheet-*.png` and `sprite-manifest.json`. The browser loads the atlas only when the player zooms into city detail.

**Distribution:** the current 147-sheet runtime set has SHA-256-matched provenance in four Polyy.AI packs, all published under CC0 1.0; see `ASSET-LICENSES.md` for source links, scope and exclusions. The atlas is a transformed set of four extracted orientations per source sheet. Do not add the separate terrain or Mythryl Studio assets to this atlas without a new licence review. Atlas pages are downloadable by players because the browser fetches them at city-detail zoom.
