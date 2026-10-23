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

## GitHub Pages

The same `dist/` is what GitHub Pages publishes, and every URL in it is relative, so it serves unchanged from a project path such as `https://<user>.github.io/<repo>/`. `.github/workflows/pages.yml` builds and deploys it on every push to `main`, and does three things a naive workflow would not:

- **It fetches the LFS assets by hand** — `git lfs pull --include=...` for the four GLBs and `public/runtime/city.soa.bin.gz` only. `lfs: true` on the checkout pulls every LFS object in the repository, the Blender originals and the legacy `city.bin.gz` included, which is 1.4 GB against a free allowance of 10 GiB a month.
- **It runs the test suite first.** A public site that is wrong is worse than one that is late.
- **It publishes the browser harnesses** into `dist/tests/`, because `src/app.js` loads them for `?verify=1` and the A/B flags and they live outside `src/`. A deployment that cannot check itself is a deployment nobody checks.

Two settings have to be right, and neither is visible in the code:

- **Settings → Pages → Source: GitHub Actions.**
- **Settings → Secrets and variables → Actions → Variables → `QM_API`** — the absolute base of the host that runs `/api`, e.g. `https://qingming-riverside.pages.dev/api`. Unset, the page asks its own origin, which is right for a deployment serving the page and the functions together and wrong for a static one: `/api/config` would land on GitHub's own 404. The build writes it into the page as `globalThis.QM_API`; the reader never sees it and never sets it.

**The model endpoints cannot move to GitHub Pages.** They hold the credential, they spend money, and GitHub Pages has no server. They stay on Cloudflare Pages Functions, which means the page and the endpoints are on two origins and the backend has to be told to answer the second one:

```sh
# Cloudflare Pages -> Settings -> Environment variables
ALLOWED_ORIGINS=https://binnong.github.io
```

`ALLOWED_ORIGINS` is an allowlist, off by default, and an origin on it is answered with the CORS headers a browser needs to read the reply at all. `*` is the check OFF and is spelled as a disable for that reason. A cross-origin POST that is not on the list is refused before the vendor is touched, which is the whole point: a rejected request has to cost nothing.

The same allowlist exists on the node path under the same name, so `HOST=0.0.0.0 ALLOWED_ORIGINS=https://binnong.github.io npm start` serves a page on another origin too.

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

### Running `server.mjs` off the local machine

`npm start` binds `127.0.0.1`. This process holds the key and spends real money per request, so reaching the network from it has to be deliberate:

```sh
HOST=0.0.0.0 ALLOWED_ORIGINS=https://your.host MINIMAX_KEY=... npm start
```

`ALLOWED_ORIGINS` is a comma-separated allowlist and it is **not optional** on a non-loopback bind — with it unset the model endpoints answer `403` to everything rather than serving a credential to the first caller that arrives, and the startup banner says so. It is checked against the request's `Origin`, which stops a page on another site from spending the key; it is not authentication, and a `curl` can send any `Origin` it likes, so put a reverse proxy in front of this before exposing it to the internet. Exposure is derived from the **bind address**, never from the request's `Host` header — an earlier version derived it from `Host` and served a request the banner had just called refused.

Static files are still served on any bind; only the model endpoints are gated.
