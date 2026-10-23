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
node tests/voice.mjs            # voice ranking against a captured real list, once-per-line guard
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

`functions/` is the only server-side code, and it is Cloudflare Pages Functions: `api/{story,tts,config}.js` are thin adapters over `_shared/routes.mjs`, which `server.mjs` imports too. **`_shared/prompt.mjs` holds the system prompt and the schema, `_shared/vendor.mjs` the provider table and the credential, `_shared/guard.mjs` the cache and the limits.** It is not in `dist/` and does not affect the static build.

### Two parallel state systems on the same instances

The crowd (`CrowdSystem`) and the ecology (`CityEcology` + `LifeBinding`) both drive instance matrices. They are kept at parity by `tests/crowd-contracts.mjs`, which stages assets exactly the way `three-engine.js` does (including giving each crowd its own writable matrix copies). Changing one staging path means changing both.

### Style material contract

`tests/contracts.mjs` pins the invariants that make the outline pass work: the colour material and its normal-pass clone must emit an **identical vertex shader** (so `defines` and custom `onBeforeCompile` deformations survive conversion and cloning), `customProgramCacheKey` must not grow an `-mrt` suffix, full-strength paint omits `<lights_fragment_begin>` while a blended paint keeps it, and out-of-range `style.set()`/`setPreset()` throw `RangeError`. Regression-test any change to `QingmingStyle` or `QingmingPass` here.

### server.mjs

Static file server plus the capture sink, plus the model endpoints. It imports the same handlers the Cloudflare Functions run (`functions/_shared/routes.mjs`), so `npm start` behaves like the deployed site and `tests/backend.mjs` exercises the real routing offline. It reads `MINIMAX_KEY` / `ANTHROPIC_KEY` from the environment and serves nothing else — the credential is never sent to a page. The dev-only `POST /proxy/minimax` egress it used to carry is gone: its whole reason was forwarding a *visitor's* key around a vendor CORS allowlist, and there is no visitor key left to forward. `POST /capture/...` only accepts a hard-coded filename allowlist, requires `Origin: http://127.0.0.1:<port>`, validates PNG/WebM magic bytes and JSON parseability, caps the body at 48 MiB, and writes to gitignored `evidence/`. Static responses carry a size+mtime ETag (304 on unchanged ~280 MB payloads) and stream `.json` gzipped.

## Conventions

The code is written in an extremely dense style — multi-statement lines, semicolon-joined, minimal whitespace, comments only where a non-obvious constraint exists. **Match the surrounding density** when editing these files; a reformatted block is a bad diff. Comments in this repo explain *why* a workaround is needed (e.g. the r179 depth-material state workaround, the light-layer trick that keeps the water pass from compiling a second program variant) — preserve that intent.

The UI is bilingual, Chinese by default, toggled from the header. `src/i18n.js` owns the switch: every table row is a `[zh, en]` pair, and the choice persists in `localStorage` under `qm-lang`. Three resolulers, because the data has three provenances — `t()` for hard-coded chrome, `T()` for values the JSON authors wrote in Chinese (their raw value is the zh side; `english()` is the en side), and `E()` for enums authored in English (a zh lookup table; the raw value is the en side). `src/english.js` is only the `T()` half now.

Two constraints make this fragile, and `tests/i18n.mjs` exists to hold them:

- **`t()` falls through to its raw argument on a missing key.** That is invisible in English — the argument is usually already English — and only shows up as an untranslated id elsewhere. The card once printed the literal word `bridge` this way.
- **`applyStatic()` assigns `textContent`, which destroys an element's children.** A `data-i18n` therefore belongs on a `<span>` that holds only the caption, never on a `<label>` that also contains a `<select>`; that mistake kills the app on first paint with "Cannot set properties of null".

`data-i18n` marks a text node, `data-i18n-a="aria-label:key,title:key"` marks attributes, and the inline `<head>` script sets `lang` from storage before CSS applies so the CJK face does not flash. JS-built text (view buttons, the walk-site list, the vessel picker) is re-rendered from `onLang` hooks instead. `html[lang=en]` in `style.css` carries the Latin-only type tuning; Chinese overrides sit beside it and the two are mutually exclusive by attribute.

Note that `applyLang()` fires every `onLang` hook **twice** — it calls `setLang()`, which already iterates the callbacks, and then iterates them again. Anything registered there must be idempotent.

## Generated character portraits

`src/ai-story.js` writes a short present-tense description plus one line of dialogue for the person you clicked. The visitor supplies their own key in the tools panel, picks a provider, and may set a custom endpoint URL (`qm-url`) — a same-origin or local proxy. The call goes browser → endpoint with `anthropic-dangerous-direct-browser-access: true`, so there is no server and `dist/` stays a pure static bundle. The SDK is not usable here — this repo has no bundler and serves `src/` raw, while the SDK pulls Node-only modules.

Two providers are configured, and they differ on exactly the two features this depends on. The capability flags come from each vendor's own compatibility table, not from what happens to work:

| | `output_config.format` | `cache_control` | auth | reachable from a browser |
|---|---|---|---|---|
| Anthropic (`claude-opus-5-5`) | supported | supported | `x-api-key` | **yes** |
| MiniMax (`MiniMax-M3`) | not documented | not documented | `Authorization: Bearer` | **no** |

**The provider table, the prompt and the key all moved to `functions/_shared/` with the credential.** What used to be a per-reader choice is now a deployment decision: `QM_PROVIDER` selects the vendor, `MINIMAX_KEY` / `ANTHROPIC_KEY` hold the credentials, and `tests/backend.mjs` pins the envelope each vendor gets.

**The CORS probe below is why that endpoint exists, and it is history — keep it, but read it as history.** Probed 2026-10-04: MiniMax's `access-control-allow-headers` permits `Authorization` and `Content-Type` but refuses both `anthropic-version` and `anthropic-dangerous-direct-browser-access`, so a browser could never call it directly at all; Anthropic's preflight permits all four, which is why the browser-direct design worked there and did not here. **The `browser:false` flag that encoded this verdict is deleted.** From inside a Worker there is no browser and no preflight, so the distinction does not exist — it was about the *caller*, and the caller is now ours. What survives is the reason: the two vendors differ on exactly the two features this depends on (`output_config.format` and `cache_control`), which is why `structured` picks a mechanism rather than a preference.

Both vendors document `output_config.effort`, and both document `tools` / `tool_choice` as fully supported — so a provider that lacks `output_config.format` forces the shape through a **tool call** rather than a prompt instruction. That distinction is not theoretical: a live MiniMax call made from Node was answered with the json_schema silently dropped, producing 16 invented keys including a name and a twelve-year history for a porter who has neither in the data. A prompt instruction would not have saved it. Sending `output_config.format` to a provider that ignores it fails *quietly*, which is why `parseResponse` validates the shape locally and returns `null` rather than rendering whatever arrived. The `system` and `messages` bodies are byte-identical across providers, so only the envelope changes when you switch.

Four rules, each of which exists because the obvious alternative is wrong:

- **Generated prose never goes through `t()`/`T()`/`E()`.** `english()` is an unanchored substring table with no word boundaries, so it turns 「八份货物」 into 「八units of cargo」 mid-sentence. `ai-story.js` may import only `t` (for its own chrome labels) and `getLang` from `i18n.js`; `tests/ai-story.mjs` enforces that over the source, not the exports.
- **The prose node is a sibling of `#inspect-body`, never a child.** `show()` rebuilds that node wholesale every 350ms from `update()`, so anything nested inside it is destroyed three times a second. The test pins the *closing* tag, because an ordering check cannot tell a sibling from a child.
- **The module never receives the engine.** It cannot reach `shadowDirty` or the render signature, so a stray refresh-on-arrival cannot turn `optimization-browser`'s `settingFrames===1` into 2 with no other symptom.
- **Spending is always an explicit click.** `offer()` runs on the 350ms tick and on every language toggle, so it only ever renders — the cache, or the 为其写照 prompt with its cost note. It never calls `generate()`; the only paths that fire a request are the 写照 button (`spend()`) and 换一句 (`again_()`). An earlier design auto-fired on the click that opened the card, which both spent money on readers who only wanted the facts and, on a failing call, re-spent every 350ms forever. While a request is in flight the card shows elapsed seconds (the only honest progress a non-streaming 20-60s call has) and a 取消 button that aborts; the 45s timeout aborts *with a reason* so it lands on the error path instead of the cancel fallback. On error the 换一句 button relabels itself 再试一次 (`aiRetry`), and a cache hit is bylined 早前写成 so a free re-render is never dressed as a fresh write.

The cache key is `plan.name + lang + state + hour`, prefixed `v3`. It used to end in the provider id and the endpoint URL; both are gone, because there is one backend and the reader cannot point it anywhere. The bump is not cosmetic — a `v2` entry was written by whichever model **the reader** chose, and this deployment is served by one model the reader never chose, so serving those back would attribute prose to a writer it did not come from. The hour rides along for the same reason it always did: it is a slider the reader controls, and a portrait written at 上午 must not be served at 薄暮.

The prompt carries Chinese source values and instructs the output language, because translating facts client-side is lossy for the same reason `english()` is. The system prompt is a byte-stable constant because any interpolation — including a language toggle — silently kills the prompt cache. Cache on `plan.name + lang + state`: `actor.id` is a construction counter that an asset reorder would re-point, and a porter cycles through states, so a name-only key would serve a description of a moment that has passed.

## The backend is the trust boundary, not a proxy

`functions/` holds the key, so everything below follows from one decision: **the browser sends a fact bag and the backend decides how to ask the question.** The obvious shortcut — page assembles the payload, backend injects the key and forwards — is an open proxy with the operator's bill attached, because a caller who chooses the prompt spends the key on arbitrary text. `guard.mjs` closes the rest of it: facts are a flat bag of ≤24 keys with ≤80-character scalar values, `lang` is one of two, and the TTS `voiceId` is a whitelist rather than a length check, because that field reaches the vendor's billing path. `tests/backend.mjs` asserts the whitelist equals `VOICES` in `src/tts.js` — the two tables are duplicated and would drift silently.

Two things did **not** move, and both are deliberate:

- **`parseResponse()` and `vet()` stayed in the browser.** The reply comes from our own backend and is still not trusted: a schema is a request, not a guarantee, and now the check also catches a compromised or misconfigured upstream. `usage` is passed through verbatim so the cache-hit note still works.
- **The prompt cache prefix is unchanged and now stronger.** `SYSTEM` no longer ships to the browser at all, so byte-stability is guaranteed by the server rather than by convention. The saving it produces is now entirely the operator's.

### What actually limits the cost, stated honestly

Three layers, and they are not equally real. **The Cache API is the one that saves money** — keyed on a hash of the request body, so the second visitor to a given portrait costs nothing and neither does the hundredth, which is what collapses 584 figures from 584 calls to roughly one. **The Cloudflare WAF rate-limiting rule on `/api/*` is the only thing that stops one person looping from one IP**, and it is a deploy-time step with zero code — the most likely thing to be missed, which is why `tests/backend.mjs` asserts `DEVELOPMENT.md` documents it. **The per-isolate counter in `guard.mjs` is close to worthless against anyone deliberate**: isolates share nothing between PoPs and are recycled constantly. It reduces accidents. It is not a security boundary and nothing should be designed as if it were. A botnet would need a Durable Object; that is out of scope for v1 and is the first thing to add if this endpoint takes real money.

`tests/backend.mjs` runs all of it offline — no network, no credential — which is possible because every refusal happens before the vendor call.

## `pick()` has no cheap version

`pick()` is the depth-marched ray the inspect card and the cursor readout both use, and it is the most expensive thing in `src/`. Measured against the real `CollisionWorld` (475 rooms, 584 people, 12 boats) over 192 rays from a street-level eye:

| | ms/call | agrees with a normal click |
|---|---|---|
| `max=170 step=.25` (default) | 3.56 | 100% |
| `max=60 step=.25` | 1.72 | 74% |
| `max=60 step=.5` | 0.98 | **21%** |

**`step` is load-bearing and must stay at `.25`.** The march takes discrete volume samples along the ray, so halving the step steps straight over a figure; the OBB and floor tests never see it. Only `max` is a safe knob, and it trades range for time.

98% of the cost is the march, not the setup: rebuilding the 475-entry `solids` array with its trig is 0.18ms (2.1%), while the march is 0.0124ms × up to 680 steps. The real fix is a spatial index over `rooms[]` — it has one, `boxGrid`, but `pick()` only uses the Z-band early-out — and that is a change to the shared collision path, so it has not been done.

So anything that probes on a moving input is **rate-limited rather than optimised**. The cursor readout (`InspectUI.probe`) runs at 12Hz, only while the pointer or camera has actually moved, capped at `max=70`: median 2.1ms, p95 4–9ms, with a GC-driven tail from `pick()`'s per-call `solids` allocation. A still cursor costs nothing. There is a `pointermove` listener that only records coordinates, and `rayAt` cannot emit a degenerate direction (its length is always ≥ 1), so the probe is never worse than those numbers.

## The ecology panel's numbers and its map key

`ecology-ui.js` renders a key under the traffic map and a block of counters in the same panel. Both
are pure functions of the ecology config (`legendRows(routes)`, `statRows(life)`) and exported so
`tests/inspect-card.mjs` can assert them headlessly — a panel that can only be checked by opening a
browser is a panel nobody opens. The key is rebuilt on a language toggle, not on the 350 ms tick,
because the route config never changes while the page is open.

**The map and the key must count the same thing.** 25 authored routes collapse onto **19 distinct
paths** — 8 pedestrian, 4 porter, 1 convoy, and 6 river channels carrying all 12 vessels (five share
one channel, three another). `chainsOf()` keys on x and y only, never z: the map is a plan projection,
so two channels at different heights are one line to the reader. `renderMap()` draws one stroke per
`chainsOf()` result and the key reports the same count, so they cannot drift. They used to: the map
picked channels by a hard-coded `vessel-0`/`vessel-1` id and drew **2 of the river's 6**, so 10 of the
12 vessels ran on lines that were not on screen. Boats are stroked at 0.9 px because all six channels
lie in a 15 px band and the old 1.4 px merged them into one line.

**Only counters observed to move are shown.** Run headlessly for 1200 simulated seconds: `berthVisits`
5 (first at 80 s), `transferred` 40, `delivered` 76, `consumed` 76, `boatDistance` 10.1 km,
`landDistance` 6.0 km. But `boatNearMisses`, `groundBlocks` and `personReplans` **never fired once in
20 minutes of simulated city time**, and `boatOverlaps` has no increment site at all — it is
initialised and never written. A row reading 0 for those would read as "no collisions ever happened"
when it means "that branch is unreachable", which is a safety claim the code cannot support. `steps`
is excluded for the opposite reason: it is seconds × 30. The three dead ones are named in the comment
on `statRows()` so nobody reinstates them as if they were a scoreboard.

## Speaking the generated line

`src/voice.js` reads the one line of dialogue the model already writes (`STORY_SCHEMA.line`, rendered at `#ai-line`) aloud. It has **two** backends behind one `sayLine()`.

**The synthesised one** (`src/tts.js`) posts the line to this origin's `POST /api/tts` and plays the returned mp3. The vendor call, the model and the key are all behind that: `functions/_shared/vendor.mjs` holds `speech-2.8-hd` and the pinned upstream, and the browser sends three fields (`text`, `voiceId`, `lang`) and nothing else. **The line still leaves the machine** — the backend forwards it to the vendor — so this is still not the same bargain as the OS voice below; what changed is who holds the credential, not what crosses the network. A 19-character line bills 36 characters, about 0.01 元; measured 2026-10-09 it came back in **0.94s** as 57012 bytes of 128kbps mp3. The unit price behind that is **3.5 元/万字符 for `hd`** (2.0 for `turbo`) with **1 汉字 = 2 字符**, per the vendor's own `minimax-tts-gen` material — so the number is checkable rather than observed once.

**The OS one** stays, and it is the fallback for every failure — a backend with no TTS key, a rate limit, a voice id the vendor no longer serves, a refused `play()`, or a machine with no voice for the language. It needs nothing and costs nothing, which is why a reader on an unconfigured instance is unaffected by any of this.

### Why the speech needed no proxy, and does not have one now

The probe that decided this is history: all three of `api.minimax.{cn,chat,com}` returned a byte-identical `access-control-allow-headers` for both `/v1/t2a_v2` and `/v1/text/chatcompletion_v2` on 2026-10-09 — `Authorization` and `Content-Type` permitted, both `anthropic-*` refused. The prose call carried both Anthropic headers and could not skip the preflight; the speech call carried exactly two and passed, which is why one needed a proxy and the other did not. `Origin` was echoed for any origin, so a Pages deploy was as reachable as localhost.

**Both go through the same backend now, so the distinction is gone rather than resolved.** What replaced it is the header assertion itself: `tests/voice.mjs` now checks that `buildTts()` sends one header and it is not a credential, which is the version of the same rule that can still fail.

### The guard is still the feature, and it now also stops a bill

`paint()` reaches the prose branch about three times a second, so a plain speak talks over itself and a plain `fetch` re-spends. Two sets, both keyed on the **line's text** rather than on `cacheKey`, because `again_()` reuses one key for a different line:

- `AIStoryUI.spoken` — the line was read, once, for the session. A language switch re-speaks: the cache key is language-scoped, so the same person arrives with a different sentence in the other tongue and that one is read.
- `voice.js failed` — the line's synthesis **terminally** failed. A network error, a rate limit, an unusable `voice_id` (which comes back as HTTP 200 with `base_resp.status_code=2013`, so `res.ok` is not the check) and a refused autoplay are all still true 350ms later. Without this set, a dead key re-spends a request on every repaint, forever. `forgetTts()` — ♪, the picker, and a change to provider, URL or key all call it.

An **interruption** is not a failure and is deliberately not recorded: `hush()`, 试听 and moving to another figure all leave the line offerable. A synthesis is also a round trip that can outlast all three, so an `epoch` counter retires a clip that lands after the reader has gone; that is why `hush()` has to bump it too. `tests/voice.mjs` drives the real panel through the first of these: ten repaints of a failing line cost **one** request, and the OS voice reads it in between.

The clip cache is keyed on text + voice + model and lives in memory only, so a reload costs the reader another 0.01 元 for a portrait they already heard. 24 clips / 4 MB with LRU eviction — an unbounded cache of object URLs is a leak that only shows up after the tab has been open for an hour.

### The voice comes from the trade

`pickVoice(lang, role, kind)` maps the `role` values the life plans already carry onto the vendor's system voices — a porter is read by the porter's voice because the data says he is one, and the reader never opens the data to notice. Hongqiao, the one subject that is always the same, gets the old voice that reads a whole scroll. `#voice-pick` lists them behind 随人物 / Follow the person, stored under `qm-tts-voice` and never overwriting `qm-voice`, so a reader who tries both keeps both choices.

One English id and ten Chinese ones, which is a deliberate asymmetry: `Chinese (Mandarin)_Reliable_Executive` was confirmed live on this account, while `English_Graceful_Lady` comes from the vendor's documentation table and the same source warns that speech-2.8 may use a shorter English naming set. One unverified id is one failure that falls back to the OS voice; ten would be ten ways for the English interface to go quiet. `GET /v1/get_voice?voice_type=system` returns **404** on `.cn`, so the list cannot be enumerated from here — confirming an id costs one short request.

### The OS backend's own facts

Four facts about the Web Speech API, all measured in Chromium on macOS on 2026-10-06 and all of them things a plausible implementation gets wrong. `tests/fixtures/voices-macos.json` is the raw 180-voice list they came from, captured rather than written by hand — a hand-written list of pleasant voices would have passed every test while sharing nothing with the machine the code runs on.

| | measured | so |
|---|---|---|
| the voice list | `getVoices()` returns `[]` for the first **2.8s** (10.3s on a cold load of this app — the event queues behind 117 MB of unpacking), then one `voiceschanged` carries all 180 | an empty list means "not yet" as often as "nothing for this language", and only the second retires the control. `voicesReady()` tells them apart; treating the first as the second hides the button on every load |
| the `default` flag | exactly **1 of 180** voices is flagged default, and it is `婷婷`/zh-CN | "the default" is not an answer in English at all |
| the list order | en-US arrives with **Albert** — a novelty voice — first and `Samantha` twenty-first | "the first match" reads the prose in a joke. `voiceFor()` ranks an explicit choice, then a short list of voices known to read prose, then the flag, then anything local |
| queueing | consecutive `speak()` calls queue, and a `cancel()` then discards everything still queued **without firing an event on it** | a second portrait would vanish undetectably. `speak()` cancels before every utterance |

A 29-character line takes **6.4 seconds** in 婷婷, which is the reason the prompt's "under twenty words" is also what keeps this out of Chrome's ~15s utterance cutoff. `say -v` and `speechSynthesis.getVoices()` do **not** agree — the CLI lists `Sinji`, no browser here reports it — so the fixture has to come from the browser.

**Marking is conditional on `sayLine()` having committed to speak, and on the synthesised path that is not the same as having spoken.** A card that rendered while the sound was off, or before the OS delivered its voices, must not be retired for the session. On the network path `sayLine()` returns true the moment the request is sent, so `reading` covers the second or so it takes to land — and `done` still comes from the clip, so an interrupted synthesis is equally never marked. Turning the sound off and on again (`forget()`) is the only way to hear a line twice, and turning it *off* cancels the line already playing, which at 6.4 s is the difference between a switch and a lie.

Two more things the real list settles. macOS localises the language inside a voice's name — 16 of the 41 English ones are `Eddy (英语（美国）)` — so `voiceLabel()` drops the parenthetical; the English picker is otherwise the exact Han leak `tests/english.mjs` exists to prevent, arriving from the OS instead of the JSON. And the list is **not** latched: `collect()` adopts a changed list and re-fires, `onVoices` keeps a late subscriber subscribed, and a bounded retry runs in case the single event is missed, because each of those is a way the control would otherwise be retired for the life of the page. `tests/voice.mjs` pins the ranking, the labels and the say/don't-say contract against the captured list; the once-per-line rule and the repaint rate are only verifiable in a browser, which is where they were checked.

## The city behind the voice

`src/ambience.js` is a bed of water, wind, oars, cart wheels and hawker cries, and unlike everything else in this file it needs **no key, no network and no money** — it is noise synthesised in the browser at the moment the reader switches it on. The risk it carries is not being loud. It is **masking**, and that risk is why the bed sits low with another 6 dB of duck whenever a line is being read.

### Why it is synthesised and not generated

The vendor also has a music endpoint, and on paper it is the obvious way to get ambience. Measured against `~/.claude/skills/minimax-music-gen`, it loses on four independent counts:

| | |
|---|---|
| **30–90 seconds** per generation, synchronous, no job or polling path | a bed that arrives a minute after a click is not a bed |
| **no duration parameter at all** | the length is whatever the model decided |
| **no loop or ambience mode** — `is_instrumental` only removes vocals | and nothing seamless to loop |
| paid tier **priced nowhere** in the vendor's own material; the host is `api.minimaxi.com`, not the `.cn` one `src/tts.js` uses | |

Any one of those is enough. The first one is enough on its own.

### The loop seam is the only hard part

The water runs for as long as the tab is open, so the wrap from the last sample back to the first happens thousands of times, and a step there is a tick every single time. The seam **only exists at all because the noise gets lowpassed** — white noise has none. Measured as the wrap step against the **median** interior one-sample step, over twelve seeds at 48 kHz:

| | median | worst |
|---|---|---|
| white noise | 0.16× | — |
| one filtering pass | 4.46× | 6.64× |
| **filter twice, keep the second half** | **0.97×** | **2.21×** |
| 50 ms cosine crossfade of the ends | — | reaches 5.4× |

Crossfading is the textbook answer and it is the wrong one: a blend leaves the broadband step sitting at the fold. Filtering the signal twice and discarding the first half is the same cost and lands inside the noise.

The test asserts all three of those rows. **A single sample proves nothing here** — the one-pass seam moves by more than 4× between seeds, so a test pinning one number would have certified whichever side it happened to land on. Twelve seeds, both bounds, and an assertion that the naive version is *worse*, so the bounds cannot pass by everything being small.

### Ducking needs a signal, not a graph connection

`voiceBusy()` in `src/voice.js` is a getter over a `busyId` token, polled by the bed on the frame loop that already exists. Routing the `<audio>` into the Web Audio graph via `createMediaElementSource` would have been the obvious way to duck, and it is unnecessary: ducking the **bed** only requires knowing that something is sounding, which `voice.js` already knows on every path.

An event channel was the wrong shape and had five ways to latch on — 试听 passes no `done`, a clip's `ended` can never fire, a synthesis that fails over to the OS voice starts a second time. The token has the same discipline `active` and `epoch` already have: `cancel()` delivers the old utterance's error *asynchronously*, long after the next one started, so without an identity check a late event clears a flag that now belongs to a different line. A 20-second watchdog is what makes getting stuck `true` impossible. One listener per event, too — `tests/voice.mjs` models an utterance as holding a single handler each way, and a second registration replaces rather than joins.

### The hawkers are the only part of this that costs anything

Eight fixed cries — 糖, 热豆腐, 磨剪子嘞 — and not generated dialogue: a 卖糖人 calls 糖 and nothing else, and that is what makes it a street cry rather than a sentence. Two to five characters each, which at **3.5 元/万字符 with 1 汉字 = 2 字符** is about **0.002 元** a cry.

Three gates stand between the reader and that money, and the first one is the important one: **`ttsReady()` — no key means no cries and no request.** The next two are races, not economics. `synthesize()` allows one request at a time and aborts the previous, so a cry started during a portrait's line would take that line's audio down with it; `ttsBusy()` (exported for exactly this) and `voiceBusy()` are both checked before spending. An abort is **not** recorded as a failure, because an abort is the dialogue winning a race it should have won — only a terminal failure lands in `cryFailed`, or a bad key would re-spend every 40 seconds forever.

Synthesis is lazy — the first time a cry is *about to* be heard, not all eight up front — and each is then reused from `tts.js`'s clip cache. Measured over simulated time: **2 requests in the first 90 seconds, then 8 for fifteen minutes of market.** `tests/ambience.mjs` drives both bounds, and it has to `await` inside the frame loop to do it: stepping simulated time synchronously leaves no chance for the fetch to resolve, so `ttsBusy()` latches and every bound would pass without testing anything.

A cry plays on the ambience graph, never through `voice.js`: it is part of the bed, so it must not duck the water and must not reach `AIStoryUI.spoken`. Its gain is set against the chain it actually plays through — the street bus at 0.5, then master at `BED` — not against 1. It was **re-derived** when the buses arrived rather than carried over: the old `CRY=4` was calibrated against a flat 0.06, and left alone it would have quietly made the hawkers quieter on the street, which is the one thing they are for.

A cry also has to be *somewhere*. `hawkers()` returns early below a street weight of 0.25, so a 卖糖人 does not call across a courtyard or over open water.

**English is absent on purpose.** `English_Graceful_Lady` is still unverified, so an English set would be a guess, and a bed is the last place to discover a guess was wrong.

### Who is rowing is read out of the art, not guessed

`three-water.js:27` finds each hull's oar tip by scanning **its own mesh** for `qmRegion===301` vertices, and `syncBoats()` fills `river.boats[i].oarContacts` only for boats that have one. So an empty `oarContacts` means the hull has no oar rigged at all — the 13.2 m barges and the fishing rowboats are told apart by the geometry, not by a velocity heuristic. The trigger is the tip crossing `three-water.js:37`'s own submerged test, so the sound lands where the spray already is.

`life.onBoatStep` would have been the obvious place to hear it and is **already taken** by `three-water.js:26` — do not take it back.

### The gain floors, and the default view is why

`riverGain()` is 1 at the bank, falls over 40 m, and then **stops at 0.3**. Away from the water means quieter, never gone: view 1's eye sits **57 m** off the centreline, so a falloff that reached zero would open the app on a city with no river in it. `tests/ambience.mjs` reads that eye out of `app.js` rather than copying it, so if the opening shot moves the assertion follows and says so.

### Three buses, and BED is derived rather than tuned

The first version had one `master` gain carrying water, wind, oars and cries together, so the city had exactly one dimmer: near the river everything rose, inland everything fell. The second splits it — `waterBus`, `windBus`, `streetBus` — all feeding `master`, which still owns the volume, the duck and the slow breathing.

```
BED = 0.1 / (1 + WIND + STREET)     with WIND 0.30, STREET 0.50
```

**BED is not a number anyone tunes.** Adding two buses is otherwise a free +3 dB that nobody notices until a line of dialogue stops being audible over them. Retune a weight and the peak follows it; `tests/ambience.mjs` asserts `BED*BUS === 0.1` for exactly this.

What this buys is **not loudness, and the distinction matters**. Measured against the level each place had *before* the split — not against the loudest place, which is the mistake that made an early draft of this section claim −10 dB for the opening panorama when it was +0.4 dB:

| | before | after | |
|---|---|---|---|
| view 1 全景 | 0.0180 | 0.0188 | +0.4 dB |
| view 2 虹桥 | 0.0600 | 0.0600 | 0 dB |
| view 5 主街 | 0.0289 | 0.0319 | +0.8 dB |

`citizens` and `riverGain` are **uncorrelated** across the ten views (Pearson r = 0.007 — the bridge is both on the water *and* the market), so summing three beds cannot manufacture dynamic range the signals do not contain. What actually changes is the **mix**, read live off the real gain nodes:

| | water | wind | street | |
|---|---|---|---|---|
| view 1 全景 | 0.300 | 0.300 | **0.017** | water 17.6× street |
| view 2 虹桥 | 1.000 | 0.195 | 0.437 | |
| view 5 主街 | 0.481 | 0.179 | **0.500** | the ratio inverts |

The real gain on a street is the **events**, not the bed: cart wheels, hoofbeats and cries are things that were not there at all before.

### How busy a place is, and why not by distance

`streetGain` counts `ecology.json`'s own `citizens[].anchor` within 30 m: **19** at view 6, which looks down on the south courtyards, **107** on the main street. Those are the measured extremes, not round numbers — the real spread is 15 dB and the curve maps it to 15 dB. Widening the span would amplify the data into more gain range than it has, which is a hand-tuned curve wearing a measurement's clothes.

The anchors **do not move**, deliberately: a place has a character, and the bed should not flicker every time one individual walks past. The things that *do* move — oars, wheels, cries — are separate one-shots on top.

**Distance to the nearest street is a dead signal and should stay dead.** All ten named views are within 11 m of an `ecology.json` land route; view 1 is 57 m from the river and 8 m from `south-alley`. The streets are everywhere, so their distance cannot tell a market from a courtyard.

### Cutoffs do not make one bed sound like another

The obvious way to make wind sound different from a market is a lower cutoff. It does not work, and this is measured: `brownFilter` is a single-pole lowpass and **peak-normalises to 0.9**, so RMS at 260 Hz, 420 Hz and 600 Hz is **0.2004 / 0.1993 / 0.1998** — one number, and the cutoff buys nothing after normalisation. The existing water bed sounds like water because of its *second* 1500 Hz layer, not its 420 Hz body.

What separates them is **modulation**: a slow 8–15 s swell for wind, a dense 2–6 Hz flutter for the market. Those are audibly different things; a cutoff between 260 and 420 is not. A consequence worth knowing before tuning anything: **every bed is the same loudness in its buffer**, because the filter normalised them. The bus is the only level control.

The flutter multiplies the murmur's own node and **not** the street bus — the bus also carries the cries and the cart one-shots, and pumping those at 4 Hz would wobble a spoken word.

### `.value=` and `setTargetAtTime` on one node is a silent bug

Each bed has **two** nodes: the bus carries the scene trim and is only ever written with `setTargetAtTime`; the bed's mix level sits on a node below it and keeps the plain `.value=` the original code used. Writing `.value` inserts a `setValueAtTime` at `currentTime`, which **cancels a pending ramp on that same node** — so a per-frame `.value=` on the bus would kill every scene transition, and the mix would snap instead of gliding while looking otherwise correct.

For the same reason every one-shot routes through a bus rather than to `destination`: a source wired straight to the speakers escapes both the duck and the volume slider, and it still passes a reachability check. `tests/ambience.mjs` asserts **four hops** — source → mix → bus → master → destination — rather than mere reachability.

### Carts: the same shape as oars, on a field that stops by itself

`v.distance` is cumulative metres and advances in exactly one place, `simulation.js:275`, inside the branch where the convoy actually moves. Loading, waiting to be let past and blocked all roll the pose back first, so **a stopped cart is silent for free** — no separate "is it moving" test to keep in sync. It is also the field the renderer writes into the wheel rotation (`simulation.js:340`), so the sound is in phase with the animation by construction. Level scales with `speedNow`, because distance keeps advancing through the deceleration ramp.

Wheel and hoof strides are **0.7 m and 1.2 m, deliberately incommensurate** — the same length would fire on the same frame forever and the cart would sound like a metronome. The test asserts they coincide on under a quarter of samples.

Two distances, both measured in the browser rather than guessed: a splash carries **90 m**, a wheel strike **55 m**. A shared 90 m put cart wheels 80 m away at audible volume and produced **17 strikes a second** on the main street with all seven convoys in earshot; at 55 m it is 10.8, dominated by the two nearest.

`caravan-main` **must stay `closed`** — on an open route `ArcPath.at()` would clamp at the end while `distance` kept growing, and a stopped cart would clack forever. That is a data property, not a code guard, so the test pins it.

`convoyBoxes()` / `trafficBlockers` are the wrong thing to reach for: they are in **model** space while `camera.eye` is **world** space, and they allocate two object literals per call in a 60 Hz callback.

### Where the label comes from, and the latch that was not one

`#ambience-scene` shows the nearest districted building's district, resolved through the `district()` helper in `i18n.js` — which had been exported, bilingual and ready, since it was written and **never called**. The node carries **no `data-i18n`**: `applyStatic()` would overwrite the district name with the chrome label on every language toggle, and only a hook could put it back.

It is written from `animate()`, not from `setView()` — `engine` does not exist at module top level, and `setView()` returns while the camera is still flying, so it would name the destination from the old vantage point. A `textContent` per frame is 60 layout invalidations a second, so it is written only on change.

It has **no distance hysteresis**, and there was one, and removing it was the fix. It existed to stop the readout flickering — view 3's nearest building is 1.3 m away — but the classifier only runs when the eye has moved more than half a metre, so a reader standing still was never going to see a flicker. The hysteresis bought nothing and cost a real latch, observed in the browser: districts interleave in plan, so the incumbent's own distance often sat just far enough away to block a legitimate switch, and one comparison pinned the label for the session.

The classifier is gated on the eye moving, or 100 ms — not on a timer, and not on CPU. It costs about 6 µs (2.0 for the 559 citizen anchors, 5.0 for the 552 building matrices), which is not an argument at all. The arguments are that a per-frame scan allocates in a callback the optimisation harnesses A/B for GC jitter, and that the answer does not change sixty times a second.

`now` is `animate()`'s timestamp, **not** `actx.currentTime`, which freezes in a hidden tab and would hold the classification stale until the reader came back.

### Missing data is not an empty street

`crowdNear()` returns **−1 when it has no data**, and `classify()` turns that into *full* street weight. Silence would be a claim about the city that this module cannot support, and it is the same default the hawker gate depends on — which is why the cry-spending assertions in `tests/ambience.mjs` survive the gate unchanged, against a fake engine that has no `life` at all.

Nothing in `updateAmbience()` may throw: `app.js` calls it inside the `try` that also re-arms `requestAnimationFrame`, so one unguarded property read is a frozen city and a permanent error banner.

### The context is built in a click and never stopped behind a switch

`AudioContext` starts suspended without a user gesture, so `startAmbience()` is only ever called from a **user gesture**, and `resume()` must settle **before** the first `start()` — a source scheduled against a suspended context's `currentTime` is scheduled at a point the clock has not reached.

Which gesture matters, and getting it wrong was a real bug rather than a theoretical one: the switch was the *only* thing that started it, so reloading with `qm-ambience` already stored as on produced **a ticked box over a silent city**, with no way out except finding that switch and cycling it. Nobody thinks to try that. The first `pointerdown` or `keydown` **anywhere** in the page now arms it, so the stored preference is honoured and the box means what it says — and it is still a user gesture inside a handler, so the autoplay rule holds. While it is waiting, `#ambience-scene` reads `t('ambPending')`, because an empty row next to a ticked box is the same lie by another name.

A `visibilitychange` handler resumes the context, because Chrome suspends in a background tab and the alternative is a checked box over a silent city. Hiding the page must **not** stop the looping sources: the context's clock freezes and resumes, whereas stop/start would jump a 10-second loop's phase.

`stopAmbience()` must clear the cart-edge record map alongside the oar one. After a restart every convoy's stride counter is a large number against no record, and without it every cart in the city clacks exactly once on the first frame back — the trap `strokeEdges`' `was===false` guard exists to close.

The controls sit at the top of the tools panel and **not** in `.toggles`: that grid is two columns of six layer switches with no storage and no volume, and a seventh child leaves an orphan cell. The slider stays live rather than appearing when the switch is on, which is also why it needs none of the `[hidden]` overrides `.panel label{display:flex}` forces on `#voice-row`.

## A followed subject's forward vector

`followForward(kind, heading)` reduces to **two** conventions, not three. A boat stores `atan2(dir[1],dir[0])`, so its forward is that direction directly. A convoy (`simulation.js:267`) and an actor (`simulation.js:193`) both store `atan2(dx,-dy)` — of the path direction and of their own movement — which solves to `[sin h, -cos h]`. Person and convoy are therefore **the same branch**; they were once written as two different expressions, which put the follow camera beside the figure instead of behind it:

| six real walkers | `along` (m, + is in front) | `side` (m) |
|---|---|---|
| written as two branches | +0.96 … −1.58 | ~2.9 |
| correct | −2.9 every frame | 0.95 |

**The bug survived a browser check because that check measured the wrong quantity.** Camera-to-subject distance reads 3.56 m against a designed 3.45 m either way — a rotation is invisible to a distance. The quantity that shows it is the component of (camera − subject) along the subject's travel direction, and the two offsets were swapped: `along` should be the −2.9 m standoff and `side` the 0.95 m offset, and they arrive exchanged. Assert on `along` and `side`, never on the distance.

The test pins this against **ground truth** — a movement `(dx,dy)`, the heading the simulation derives from it, and the requirement that the forward vector equal the unit movement. The previous version related the three kinds to each other (`person == rot(boat, −2h)`), which expands to exactly the person branch: algebraically identical to its own definition, so it certified whatever the code said. Relations between branches cannot fail. Ground truth can, and did.

## The public site

GitHub Pages publishes the same `dist/` the other hosts do, and it is the only one of them anyone
can reach without an account. Two facts shape everything about it.

**A static host has no server, and the model endpoints are a server.** `functions/` holds the
credential and spends money per request; GitHub cannot run it. So the page and the endpoints end up
on two origins, and the endpoints have to be told to answer the second one. `ALLOWED_ORIGINS` is
that list — off by default, an origin on it answered with the CORS headers a browser needs to read
the reply at all, and `*` spelled as a *disable* because an allowlist of every origin is the check
turned off. A cross-origin POST that is not on the list is refused **before the vendor is touched**:
a rejected request has to cost nothing, and that refusal is the only thing standing between a page
on another site and the operator's bill.

**`QM_API` is the base URL of the endpoints, and the build writes it.** Not the reader: there is no
field, no localStorage key and no credential on the machine. Unset, the page asks its own origin,
which is the case for every deployment that serves both halves together.

The refusal is not free of a subtlety. **A browser's same-origin GET sends no `Origin` header at
all** — the header is added for every method except GET/HEAD — and `/api/config` is exactly that
request. The old check refused it, so the config probe failed on every same-origin deployment and
the page fell back to assuming its features were on. `Sec-Fetch-Site` is what separates a browser's
GET from a script: the browser sends `same-origin`, curl sends nothing at all.

The site is 345 MB and all of it is fetched on the first visit. That is the same payload the other
hosts serve and it carries the same warning: desktop browsers and a fast connection.

## Working tree note

The repo was last committed with a Cloudflare Pages deploy while `DEVELOPMENT.md` and `vercel.json` still describe Vercel. The LFS payloads are all fetched (`assets/Qingming_Current_City.glb` 188M, `public/runtime/city.bin.gz` 136M), so `tools/build-web.mjs` and `tests/package.mjs` can hash-verify them; if a checkout ever shows them as deleted, restore with `git lfs pull` / `git restore` rather than assuming a missing file is a real one — a pointer stub is ~130 bytes and still reads as "present".
