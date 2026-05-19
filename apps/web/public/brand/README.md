# Darts Counter — Logo Assets

Authentic 20-segment dartboard mark in classic black / cream / green / red, tuned to the dark-navy + uppercase typography of the existing UI.

## Files

| File | Use |
|---|---|
| `darts-logo-full.svg` | Full logo with wordmark — header, splash, README, social card |
| `darts-logo-full.png` | Same, raster (1360×640) — for emails / non-SVG contexts |
| `darts-icon.svg` | Icon-only, detailed segments — favicon for HiDPI / `<link rel="icon">` |
| `darts-favicon.svg` | Icon-only, simplified concentric rings — fallback for tiny sizes |
| `darts-icon-{16,32,48,64,96,180,192,512}.png` | Raster icons at standard sizes |
| `favicon.ico` | Multi-resolution ICO (16/32/48) — legacy browsers, Windows |
| `site.webmanifest` | PWA manifest, references the 192/512 icons |

## Drop-in HTML

Put all files at the web root and add this to your `<head>`:

```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/darts-icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/darts-icon-180.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#0F1827">
```

## Palette

| Color | Hex | Where |
|---|---|---|
| Panel background | `#0F1827` | Card / theme color |
| Cream | `#E8DCC0` | Light segments |
| Black | `#1A1A1A` | Dark segments + surround |
| Dartboard red | `#C53030` | Doubles / trebles / bullseye |
| Dartboard green | `#2F855A` | Doubles / trebles / outer bull |
| Accent red | `#E53E3E` | UI divider bars (matches existing app) |

## Notes

- The detailed icon keeps all 20 segments + both scoring rings. It reads correctly down to roughly 48px.
- Below that, browsers will pick `favicon.ico` or `darts-favicon.svg`, which is a simplified ring stack that still reads as a dartboard at 16×16.
- The 512px PNG is also flagged `purpose: "maskable"` in the manifest. The mark has enough padding inside the viewBox that Android's mask crop won't clip the rings.
