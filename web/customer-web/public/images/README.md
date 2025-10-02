Image guidelines for Customer Web (mobile-first)

Where to put images
- Menu item images: place under `images/menu/` and name by SKU, e.g. `images/menu/SUSHI-SALMON.webp`.
- Generic/placeholder image: put under `images/placeholders/` (e.g. `images/placeholders/default.webp`).

Recommended specs
- Dimensions: target width 640px (serves crisp at ~320px display width on 2x DPR phones).
- Aspect ratio: square 1:1 (640x640) or 4:3 (640x480). Keep consistent across items.
- Format: `.webp` preferred, fallback `.jpg` acceptable.
- File size: aim for 40–80 KB per image (max ~120 KB).
- Naming: exactly the SKU (uppercase, hyphens) with an image extension.

Current SKU examples (use these exact filenames if assets are available)
- DRINK-COKE.webp
- DRINK-GREENTEA.webp
- DRINK-ORANGEJUICE.webp
- DRINK-WATER.webp
- DRINK-COFFEE.webp
- ROLL-AVOCADO.webp
- ROLL-CALIFORNIA.webp
- ROLL-EEL.webp
- SOUP-MISO.webp
- SUSHI-KANI.webp
- SUSHI-SALMON.webp
- SUSHI-TUNA.webp
- SUSHI-UNAGI.webp
- SUSHI-TAMAGO.webp

Tips
- Use `object-fit: cover` in the UI so images crop gracefully in a fixed-height slot.
- Prefer consistent lighting/background so the list looks tidy.

