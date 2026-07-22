# Upstream reference audit

Checked on 2026-07-23.

- JiChiTai commit `1e5efc7f8b313d54746dfe30d863b6e6a255a2c5`: the app keeps its green design tokens, light/dark system palette, 3px `focus-visible` outline, restrained borders, and choice-card selected/focus states. Fukushu intentionally uses its own components and a narrower 800px content limit.
- cfw-fileup commit `a4885164e814a5baf40180c3069df182e5c185f5`: the repository keeps the same `packages/*` pnpm workspace shape. Fukushu intentionally omits server packages because it is a static-assets-only SPA.

These repositories are design and structure references, not vendored code.
