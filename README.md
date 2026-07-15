# Desktop Pet

Interactive Electron desktop pet for macOS and Windows. The app uses a transparent always-on-top window, alpha-aware mouse passthrough, Canvas sprite animation, pointer reactions, dragging, and left/right edge docking.

## Develop

Requires Node.js 24 and pnpm 11.

```bash
pnpm install
pnpm start
```

Quality checks:

```bash
pnpm typecheck
pnpm test
pnpm package
pnpm test:e2e
```

Build the current platform's installer:

```bash
pnpm make
```

## Pet assets

The default Pet is `Penguin Suit Administrator (B.)`. Its release atlas and manifest live under `public/pets/default/`. Local generation rows, extracted frames, QA media, and installers are kept in the ignored `work/` and `outputs/` directories.

When local decoded source rows are available, rebuild the atlas with `pnpm assets:build`, then copy `work/pet-v1/final/atlas.webp` to `public/pets/default/atlas.webp`.

To replace the Pet, update both files under `public/pets/default/`:

- `atlas.webp`: lossless transparent WebP, 16 columns, 256x256 pixels per cell.
- `pet.json`: animation rows, frame durations, reduced-motion frames, and interaction bindings.

Run `pnpm assets:validate` after replacement. It verifies dimensions, bindings, frame counts, non-empty used cells, and transparent unused cells.

The required v1 animations are `idle`, `look-left`, `look-right`, `click-reaction`, `drag-left`, `drag-right`, `dock-left-enter`, `dock-left-idle`, `dock-right-enter`, and `dock-right-idle`. Keep identity, scale, baseline, palette, props, and facing direction consistent across every row. Validate the final contact sheet and per-row GIFs visually before release.

The checked-in `pnpm assets:placeholder` generator overwrites `atlas.webp` with a development placeholder. Run it only when intentionally restoring the placeholder; normal start and packaging commands never overwrite Pet artwork.

## Signing

The GitHub Actions workflow builds on macOS and Windows. Configure these repository secrets when signed artifacts are required:

- macOS: `MACOS_CERTIFICATE_P12`, `MACOS_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- Windows: `WINDOWS_CERTIFICATE_P12`, `WINDOWS_CERTIFICATE_PASSWORD`
