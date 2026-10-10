# Development handoff

The repository root is the former `Qingming_Final` directory. Other scene versions, local rollback archives and exploratory captures are excluded from Git. Runtime geometry, textures, production inputs, Blender originals and bundled Three.js are included. Large GLB, Blender and compressed geometry files use Git LFS.

## Setup

Requires Node.js >=22.15, Git LFS and a browser with WebGL2. There are no npm runtime dependencies.

```sh
git lfs install
git lfs pull
npm test
npm start
```

With the server running, execute `npm run test:package` in a second terminal.

The preview listens on `127.0.0.1:4193`. For GMK development, forward that port from your Mac:

```sh
ssh -L 4193:127.0.0.1:4193 gmk
```

Run `npm start` in `/mnt/data/H5Games/qingming` on GMK, then visit `http://127.0.0.1:4193/` on the Mac. Nothing is exposed publicly.

## Asset generation

Blender and Python with NumPy are required to regenerate assets. Set `BLENDER` if Blender is not on PATH. `npm run build:assets` derives performance assets from the stored authoritative scene. The explicit `-- --rebuild-scene` path reconstructs the authoring scene and should be used only for that purpose. Commit runtime geometry, SoA and their manifests together after validation.

```sh
npm run test:auto-assets
blender --background --factory-startup --python-exit-code 1 --python tests/auto-structure.py
```

## Public web build

`npm run build` creates `dist/` from the checked-out LFS runtime assets. It verifies the SoA source hash, splits its gzip bytes into 32 MiB parts, and copies the four GLBs used by the renderer, textures, data and bundled code. `npm run test:web` checks split loading, the original local single-file path and missing-part errors. The public build hides capture/export controls that require `server.mjs`; local capture remains available through `npm start`. Production Blender files and newly generated captures are kept outside the public output.

The independent Vercel project is `mike007jds-projects/qingming-riverside`, with Git LFS enabled, framework Other, `npm run build`, and output `dist`. Pushes to `main` build the site. A local production build can be checked with `vercel pull --environment=production` followed by `vercel build --prod`; deploy that checked output using `vercel deploy --prebuilt --prod`. Keep Vercel credentials in environment variables. Runtime assets remain large (about 345 MiB), so desktop browsers and a fast connection are recommended; this release does not claim stable 30 fps.

## The model backend

The generated portraits, the spoken line and the hawker cries are served by Cloudflare Pages Functions in `functions/`. The visitor configures nothing — there is no key input, no endpoint field and no provider picker, because the credential lives in the environment and never reaches the browser. `functions/api/` is a thin adapter; all the logic is in `functions/_shared/`, which `server.mjs` imports too, so `npm start` behaves like the deployed site and `tests/backend.mjs` exercises the real routing with no network and no key.

**Two deploy steps are required, and nothing in the code fails loudly if you skip either.**

```sh
wrangler pages secret put MINIMAX_KEY     # the prose + speech credential; no key, every request is 503
wrangler pages secret put ANTHROPIC_KEY   # optional: only if QM_PROVIDER=anthropic
```

Then configure a **Cloudflare WAF rate-limiting rule** on `/api/*` — 10 requests per minute per IP. This is the only control that stops one person running a loop from one address. The in-function limiter is per-isolate and shares nothing between PoPs; it reduces accidents and buys nothing against anyone deliberate. `tests/backend.mjs` asserts both steps are documented here, because a deploy-time step that is not written down is one that gets missed.

Set `QM_PROVIDER` to `anthropic` or `minimax` (default). Neither key is committed, and `.dev.vars` is gitignored — `npm start` reads `MINIMAX_KEY` / `ANTHROPIC_KEY` straight from the environment.

A `functions/` directory is deployed from the repository root and is **not** part of `dist/`, so the static build is unaffected by any of this.
