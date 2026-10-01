# Festival art pack

The pack adds an original illustrated festival backdrop, warmer card frames and paper surfaces, and sharper board labels. The 36 racer illustrations, original scoring stars and trip illustrations, rules, board coordinates, and colors identifying players remain unchanged.

## Developer opt-in

Classic artwork is the default, even after this PR is merged. Set `VITE_ART_PACK=festival` before starting Vite or making a production build to enable the pack. Omit it or set it to `classic` to retain the original textures, backgrounds, and renderer settings. Restart/rebuild after changing it. The mobile announcement and playful-prop PRs do not depend on this flag or this PR.

## Assets

- `apps/web/public/assets/art-pack/festival-background.webp`: 1672 × 941, approximately 511 KiB. Generated with the built-in imagegen tool for this project, then encoded as WebP without changing dimensions. Decorative scenery contains no playable track or rules. The same asset is used by the entry page, card screens, and 3D tabletop.
- Existing racer portraits and transparent tokens are retained at 235 × 235. Card text, frames, and ornamentation render at screen resolution; this pack does not claim to recover detail absent from the original portraits.
- Original board center illustrations, scoring stars, and trip-space pictures remain in `print-atlas.webp`. Numbered direction arrows and Mild Mile numbers render directly on the canvas when the pack is enabled, using the original color palette and the correct direction along each board row. The original marks are retained when it is disabled.

## Rendering

With the pack enabled, the board canvas uses up to 3× reference resolution (3600 × 1080), reduced to fit the GPU's maximum texture dimension. The scene renders at device pixel ratio up to 2 and uses anisotropic filtering up to the supported limit, capped at 16. These caps bound memory and fill-rate costs on phones. Existing texture disposal is preserved, including the new tabletop texture. When disabled, the new scenery is never requested.

No backend or game-rule changes are required. `art-pack.css` is loaded after the layout styles and is scoped to `html.festival-art`; generated scenery is a background, leaving rules and interactive UI as real text. A flat base color remains available while the scenery loads.

## Updating the pack

Replace the decorative WebP and update this document's dimensions and byte size. Preserve its relative asset path so both the Vite build and Three.js loader work under `/MagicalAthleteOL/`. Do not bake localized card text, tile numbers, or rules into the background image.
