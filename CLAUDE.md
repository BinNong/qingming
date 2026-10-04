# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A self-contained Three.js/WebGL2 reconstruction of the Qingming Riverside scroll (`Along the River During the Qingming Festival`), rendered as a living city: 584 rigged figures, boats/carts traffic, walkable buildings, and a GPU-simulated river, painted through a "scroll" (ink-on-silk) post-process.

There are **no npm runtime dependencies and no bundler**. `vendor/` holds a checked-in Three.js r179 plus `GLTFLoader`, and `index.html` resolves `three` / `three/core` / `qingming/micro` through an import map. Every file in `src/` is a plain ES module served straight to the browser.

## Commands

```sh
git lfs pull          # required first: ~345 MiB of GLB/Blender/geometry assets
npm test              # all headless Node contract tests (see below)
npm start             # static server + capture endpoint on http://127.0.0.1:4193/
```

With the server up, in a second terminal:

```sh
npm run test:package      # verifies runtime assets, GLB hashes, live HTTP endpoints
```

`tests/package.mjs` is part of `npm test` and needs those live endpoints, so it starts `server.mjs`
itself when nothing is listening on `PORT` and kills only what it started. A server you launched
first is left running.

Run a single test file directly (they are standalone, no test runner):

```sh
node tests/contracts.mjs        # collision, navigation, ecology, material/style contracts
node tests/crowd-contracts.mjs  # skinned crowd + ecology parity against the manifests
node tests/render-quality.mjs   # water readback, quality tiers, resize/MSAA
node tests/english.mjs          # no Han characters leak into the English UI
node tests/i18n.mjs             # bilingual chrome, data values and mesh-id leaks
node tests/ai-story.mjs         # generated-portrait facts, guards, cache key and DOM contract
node tests/auto-batches.mjs     # native Auto batching / LOD / culling
node tests/capture.mjs          # server.mjs capture endpoint
node tests/web-loader.mjs       # split-SoA loading path
```

Asset generation needs Blender + Python/NumPy (`BLENDER=<path>` to override):

```sh
npm run build:assets                    # derive Auto geometry from the stored scene
npm run build:assets -- --rebuild-scene # re-author the Blender scene from production inputs (destructive)
npm run test:auto-assets                # asset budgets and bindings
blender --background --factory-startup --python-exit-code 1 --python tests/auto-structure.py
```

Static site build: `npm run build` → `dist/`; `npm run build:pages` additionally rewrites asset URLs to the remote `qingming-assets.bubucn.com` base and ships no local assets. `dist/` and `evidence/` are gitignored.

## In-browser test harnesses

Query flags on the local server drive GPU checks that cannot run headless. Add `&autorun=1&save=<name>` to run unattended and POST the JSON report to `evidence/quality/`.

| URL | What it does |
| --- | --- |
| `?verify=1` | 42 water/collision/interaction/paint checks, 3 styles × 10 views |
| `?opttest=1&mode=quality` | static A/B over 3 styles × views 1/3/8 plus a real motion-sampling check |
| `?opttest=1` | tiling batching, static matrices, outline skipping, pause behaviour |
| `?lodtest=1`, `?msaatest=1`, `?perfreview=1`, `?ratiotest=1`, `?profile=1` | LOD comparison, MSAA snapshot restore, perf A/B, pixel-ratio probe, six-pass wall-clock timing |
| any of the above + `&full=1` | 4K stills for 3 styles × 10 views |

These report pixel differences and GPU/motion behaviour only. They are **not** a 30 fps or visual sign-off. `?profile=1` timings exclude water GPU update and readback and must not be read as CPU load.

## Architecture

### Data pipeline

`public/runtime/` is the runtime contract, generated from Blender:

- `city.json` — manifest: per-asset `draws` (material/range slices), `instances` (matrices), `bounds`, optional `rig`, `lodDraws`/`autoLodDraws`, plus a `geometry` block describing the SoA attribute layout.
- `city.soa.bin.gz` — one decompressed buffer holding position/normal/uv/color/joints/weights/region/index blocks. `src/loader.js` and `ThreeCityEngine.createGeometry` bounds-check every block against the manifest and treat a mismatch as a hard load error — there is no silent fallback to the interleaved `city.bin.gz`.
- `navigation.json` (floors, doors, landmarks, routes), `rigs.json` (skeleton joints + clips), `ecology.json` (boats, convoys, citizens, docks, routes), and `texture_*.png` / `auto_npc_atlas.png`.

`production/` holds the authoritative Blender inputs and manifests; `tools/*.py` run inside `blender --background` and must ship runtime geometry, SoA and their manifests together after `npm run test:auto-assets`.

### Coordinate systems

Blender-authored data is **Z-up**; the world is **Y-up in metres**. The conversion is a single matrix, `Z_TO_Y` in `src/simulation.js`, applied to instance matrices at ingest (`three-engine.js`, and the same staging is duplicated in the Node tests). Legacy ecology data is converted at its own ingest point — don't assume a manifest matrix is already world-space.

### Module map (`src/`)

- `app.js` — all DOM wiring, camera modes (orbit/fly/walk/tour), the 10 named views, and capture/record UI. It also publishes the `window.__*` test surface (`__engine`, `__setCamera`, `__advanceWorld`, `__stepFrame`, `render_game_to_text`, …) that every browser harness drives.
- `loader.js` — fetch + decompress + length-check the runtime payload.
- `three-engine.js` — `ThreeCityEngine`: renderer setup, SoA → `InstancedMesh` batches (one batch per asset × LOD, one draw range per material), per-instance frustum/shadow culling with only the active prefix uploaded, quality tiers, reflection pass, and the frame signature that lets `renderIfChanged` skip unchanged frames.
- `three-water.js` (`ThreeRiver`) + `advanced-river.js` (`AdvancedRiver`, GLSL) — GPU water: stepping, spray, boat hull sampling via async PBO readback with a synchronous fallback when a read is already in flight.
- `QingmingStyle.js` / `QingmingPass.js` — the scroll look. Style *converts* materials through `onBeforeCompile` (paper wash, ink lines, grain, relief); the pass renders a second normal/depth channel for outlines.
- `simulation.js` — engine-independent, Three.js-free core: `CollisionWorld` (floors, doors, grid candidates), `Walker`, `CrowdSystem` (31-joint skinning, clip blending), `CityEcology` (boats, convoys, porter/trade economy, fixed 1/30 s step), `LifeBinding` (writes simulation state into instance attributes), `LandPlanner`, `ArcPath`.
- `three-materials.js`, `auto-batches.js`, `scene-details.js`, `lod.js`, `ecology-ui.js`, `english.js`, `i18n.js`, `ai-story.js`, `micro.js` (a base64 PNG data module, not logic).

### Two parallel state systems on the same instances

The crowd (`CrowdSystem`) and the ecology (`CityEcology` + `LifeBinding`) both drive instance matrices. They are kept at parity by `tests/crowd-contracts.mjs`, which stages assets exactly the way `three-engine.js` does (including giving each crowd its own writable matrix copies). Changing one staging path means changing both.

### Style material contract

`tests/contracts.mjs` pins the invariants that make the outline pass work: the colour material and its normal-pass clone must emit an **identical vertex shader** (so `defines` and custom `onBeforeCompile` deformations survive conversion and cloning), `customProgramCacheKey` must not grow an `-mrt` suffix, full-strength paint omits `<lights_fragment_begin>` while a blended paint keeps it, and out-of-range `style.set()`/`setPreset()` throw `RangeError`. Regression-test any change to `QingmingStyle` or `QingmingPass` here.

### server.mjs

Static file server plus the capture sink. `POST /capture/...` only accepts a hard-coded filename allowlist, requires `Origin: http://127.0.0.1:<port>`, validates PNG/WebM magic bytes and JSON parseability, caps the body at 48 MiB, and writes to gitignored `evidence/`. Static responses carry a size+mtime ETag (304 on unchanged ~280 MB payloads) and stream `.json` gzipped.

## Conventions

The code is written in an extremely dense style — multi-statement lines, semicolon-joined, minimal whitespace, comments only where a non-obvious constraint exists. **Match the surrounding density** when editing these files; a reformatted block is a bad diff. Comments in this repo explain *why* a workaround is needed (e.g. the r179 depth-material state workaround, the light-layer trick that keeps the water pass from compiling a second program variant) — preserve that intent.

The UI is bilingual, Chinese by default, toggled from the header. `src/i18n.js` owns the switch: every table row is a `[zh, en]` pair, and the choice persists in `localStorage` under `qm-lang`. Three resolulers, because the data has three provenances — `t()` for hard-coded chrome, `T()` for values the JSON authors wrote in Chinese (their raw value is the zh side; `english()` is the en side), and `E()` for enums authored in English (a zh lookup table; the raw value is the en side). `src/english.js` is only the `T()` half now.

Two constraints make this fragile, and `tests/i18n.mjs` exists to hold them:

- **`t()` falls through to its raw argument on a missing key.** That is invisible in English — the argument is usually already English — and only shows up as an untranslated id elsewhere. The card once printed the literal word `bridge` this way.
- **`applyStatic()` assigns `textContent`, which destroys an element's children.** A `data-i18n` therefore belongs on a `<span>` that holds only the caption, never on a `<label>` that also contains a `<select>`; that mistake kills the app on first paint with "Cannot set properties of null".

`data-i18n` marks a text node, `data-i18n-a="aria-label:key,title:key"` marks attributes, and the inline `<head>` script sets `lang` from storage before CSS applies so the CJK face does not flash. JS-built text (view buttons, the walk-site list, the vessel picker) is re-rendered from `onLang` hooks instead. `html[lang=en]` in `style.css` carries the Latin-only type tuning; Chinese overrides sit beside it and the two are mutually exclusive by attribute.

Note that `applyLang()` fires every `onLang` hook **twice** — it calls `setLang()`, which already iterates the callbacks, and then iterates them again. Anything registered there must be idempotent.

## Generated character portraits

`src/ai-story.js` writes a short present-tense description plus one line of dialogue for the person you clicked. The visitor supplies their own key in the tools panel and picks a provider; the call goes browser → provider with `anthropic-dangerous-direct-browser-access: true`, so there is no server and `dist/` stays a pure static bundle. The SDK is not usable here — this repo has no bundler and serves `src/` raw, while the SDK pulls Node-only modules.

Two providers are configured, and they differ on exactly the two features this depends on. The capability flags come from each vendor's own compatibility table, not from what happens to work:

| | `output_config.format` | `cache_control` | auth | reachable from a browser |
|---|---|---|---|---|
| Anthropic (`claude-opus-5-5`) | supported | supported | `x-api-key` | **yes** |
| MiniMax (`MiniMax-M3`) | not documented | not documented | `Authorization: Bearer` | **no** |

**MiniMax cannot be called from the browser at all, and this is a server-side fact, not a code problem.** Probing its CORS preflight on 2026-10-04: `access-control-allow-headers` permits `Authorization` and `Content-Type` but refuses both `anthropic-version` and `anthropic-dangerous-direct-browser-access`. The preflight therefore fails and the browser never sends the request. There is no workaround — a request carrying a key as `application/json` is never a "simple request", so the preflight cannot be skipped. Anthropic's preflight returns `access-control-allow-headers: content-type,x-api-key,anthropic-version,anthropic-dangerous-direct-browser-access`, which is why the browser-direct design works there. MiniMax is kept in the table as `browser:false` and excluded from the picker and from `providerList()`; offering it produced a raw CORS message in the card with no way back short of clearing localStorage. Reaching it would need a same-origin proxy, which this static deploy does not have.

Both vendors document `output_config.effort`, and both document `tools` / `tool_choice` as fully supported — so a provider that lacks `output_config.format` forces the shape through a **tool call** rather than a prompt instruction. That distinction is not theoretical: a live MiniMax call made from Node was answered with the json_schema silently dropped, producing 16 invented keys including a name and a twelve-year history for a porter who has neither in the data. A prompt instruction would not have saved it. Sending `output_config.format` to a provider that ignores it fails *quietly*, which is why `parseResponse` validates the shape locally and returns `null` rather than rendering whatever arrived. The `system` and `messages` bodies are byte-identical across providers, so only the envelope changes when you switch.

Four rules, each of which exists because the obvious alternative is wrong:

- **Generated prose never goes through `t()`/`T()`/`E()`.** `english()` is an unanchored substring table with no word boundaries, so it turns 「八份货物」 into 「八units of cargo」 mid-sentence. `ai-story.js` may import only `t` (for its own chrome labels) and `getLang` from `i18n.js`; `tests/ai-story.mjs` enforces that over the source, not the exports.
- **The prose node is a sibling of `#inspect-body`, never a child.** `show()` rebuilds that node wholesale every 350ms from `update()`, so anything nested inside it is destroyed three times a second. The test pins the *closing* tag, because an ordering check cannot tell a sibling from a child.
- **The module never receives the engine.** It cannot reach `shadowDirty` or the render signature, so a stray refresh-on-arrival cannot turn `optimization-browser`'s `settingFrames===1` into 2 with no other symptom.
- **Only a click spends money.** `show()` also runs from the language toggle and the 350ms tick, so `openAt()` sets a `fresh` flag that `show()` consumes; `offer()` is idempotent and returns early on a cache hit or an in-flight key.

The cache key is `plan.name + lang + state + provider` — the provider is in it because two models write the same person differently, and serving one model's prose under the other's name misrepresents where the words came from.

The prompt carries Chinese source values and instructs the output language, because translating facts client-side is lossy for the same reason `english()` is. The system prompt is a byte-stable constant because any interpolation — including a language toggle — silently kills the prompt cache. Cache on `plan.name + lang + state`: `actor.id` is a construction counter that an asset reorder would re-point, and a porter cycles through states, so a name-only key would serve a description of a moment that has passed.

## Working tree note

The repo was last committed with a Cloudflare Pages deploy while `DEVELOPMENT.md` and `vercel.json` still describe Vercel. The working tree also currently has several LFS files deleted (`assets/Qingming_Current_City.glb`, `production/*.blend`, `public/runtime/city.bin.gz`) — restore them (`git lfs pull` / `git restore`) before running the app or the build, since `tools/build-web.mjs` and `tests/package.mjs` hash-verify those bytes.
