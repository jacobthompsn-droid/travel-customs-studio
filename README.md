# Travel Customs

**A desktop app that publishes a website, and the website it publishes.**

Live at **[thetravelcustoms.com](https://thetravelcustoms.com)**.

The interesting half of this repository is `studio/` — **Travel Customs Studio**, the Windows
desktop application I built to write, preview, and publish the site. The site itself is a static
Astro build; the app is what operates it.

### ▶ [Click through the app, without installing anything](https://jacobthompsn-droid.github.io/travel-customs-studio/demo/)

Studio is a Windows desktop app, so a repository can only show you its source. That link is an
interactive walkthrough that runs in the browser: open posts and categories in the editor, switch
to the **Preview** tab (which embeds the real live site), and press **Publish** to watch the
pipeline run end to end. A checkbox lets you simulate a broken post so you can see the build gate
refuse to publish and leave the live site untouched.

It is a reproduction, not the real binary — edit anything you like, nothing is saved, and a
refresh puts it all back.

---

## Why this exists

I wanted a travel blog I could update the way you'd update a note — open an app, write, press a
button — without the two things that usually come with that convenience: a monthly bill and a
server I'd have to keep patched.

Off-the-shelf options each failed on one axis. WordPress and Ghost solve authoring but need a
server, a database, and ongoing maintenance and cost. Hosted headless CMSes (Contentful, Sanity)
drop the server but add a SaaS dependency my content then lives inside. A plain static site with
Markdown files solves cost and security completely — but leaves publishing as *open a terminal, run
a build, commit, push*, which is a sequence I did not want to perform every time I had something to
write, and which has no guardrail against shipping something broken.

So the content layer is a static site, and the operating layer is a desktop app I built on top of
it. The idea the project is built around:

> **A CMS solves editing. It doesn't solve operating.**

The hard part was never "how do I change this paragraph." It was "how does a change get from my
laptop to the internet without a step that can silently break the live site."

---

## Travel Customs Studio

A double-clickable Windows app with three actions: **Write**, **Preview**, **Publish.**

On launch it spawns the Astro dev server as a child process — using Electron's own bundled Node via
`ELECTRON_RUN_AS_NODE`, so there's no separate Node installation to manage — and presents two views
over it: the Keystatic editor for writing, and the real rendered site for preview. What you see in
Preview is what deploys, because it's the same build and the same components.

| File | Role |
|---|---|
| [`studio/main.js`](studio/main.js) | Electron main process — dev-server lifecycle, windows, IPC, settings, guardrails |
| [`studio/publish.js`](studio/publish.js) | The publish pipeline |
| [`studio/preload.js`](studio/preload.js) | The IPC surface — deliberately minimal |
| [`studio/renderer/`](studio/renderer/) | The app's own UI — sidebar, status, publish progress |
| [`studio/scripts/resize-images.js`](studio/scripts/resize-images.js) | Image processing on import |

### The publish pipeline

This is the part I'd point at first. **Publish** runs four steps in order, and each one can stop the
pipeline safely.

```
  Studio (my laptop)                          GitHub              Cloudflare Pages
  ──────────────────                          ──────              ────────────────
  1. Resize images    ──┐
     cap ~2000px,       │
     strip EXIF         │
                        ▼
  2. BUILD GATE      astro build ─── fails ──▶ STOP. Nothing committed, nothing
     (local)            │                      pushed. Live site unchanged.
                        │ passes
                        ▼
  3. Commit          git commit ─────────────▶ local snapshot — work is safe even
     isomorphic-git     │                      if every later step fails
                        │
                        ▼
  4. Push            git push ──────────────▶ private repo ──triggers build──▶
                                                                 astro build
                                                                 deploy to edge
                                                                 thetravelcustoms.com
                                                                 + one-click rollback
```

**Step 2 is the rule the whole system is built around: nothing reaches the live site without a
successful local build first.** There is no code path around it. A broken image reference, a post
pointing at a category that no longer exists, malformed frontmatter — all fail locally, before
anything is committed, and surface as plain English rather than a stack trace:

> Something in your site has a problem, so it was NOT published. Nothing on your live site changed.

**The ordering is deliberate.** The commit happens *before* the push, so a network failure mid-publish
leaves the work committed locally rather than lost — the app reports *"Saved on your computer, but
couldn't reach GitHub"* and the operation is safe to retry. And the push runs **even when there are
zero local changes**, because the remote can legitimately be behind the local repo; an early return
before the push is exactly what broke the first real publish, and the comment explaining why is
still in the code.

Three independent safety nets, by design:

1. **The local build gate** — nothing broken ships.
2. **Git history** — every publish is a labeled, restorable snapshot and an off-machine backup.
3. **Cloudflare rollback** — any previous deployment restores in one click.

### Guardrails

Built for failure modes that were predictable rather than discovered:

- Deleting a category that posts still use **warns immediately**, instead of failing at publish time.
- Closing the window mid-publish is **blocked**, rather than stranding a half-finished push.
- The dev server **restarts itself** up to three times before surfacing an error, instead of leaving
  a dead window.
- On launch the app checks whether the remote is ahead and warns before a publish could overwrite it.

---

## The site it publishes

Astro 5, static output, at the project root. Content is plain Markdown in `src/content/` — one
folder per post with its images colocated. Posts are typed and validated by an Astro
content-collection schema, so a malformed post is a build error, not a broken page.

Categories are **data, not code**: they live in their own collection
(`src/content/categories/*.yaml`), and the category pages, the nav, and the homepage strip are all
generated from that data. Adding a category creates its page and its nav entry with no code change.

The published output is pure static files — **no server, no database, no admin surface, nothing
listening.** Keystatic, the browser-based editor, is wired into the dev server only and explicitly
excluded from the production build, because its server routes would otherwise force the site off
static output.

SEO is built into the templates rather than bolted on: per-post title and description, Open Graph
images, JSON-LD (`BlogPosting` + `BreadcrumbList`), sitemap, RSS, human-readable slugs.

---

## Constraints I set and held

Enforced through the build, not aspirations.

| Constraint | How it's held |
|---|---|
| **No database** | Content is files. Categories are files. There is nothing to query. |
| **No backend, no SSR** | `output: 'static'`, no adapter. Keystatic is dev-only so it can't drag in server routes. |
| **~$12/year to run** | The domain is the only guaranteed cost. Cloudflare Pages free tier, GitHub free, tooling all open-source. |
| **The build gate is non-negotiable** | No path to production skips a clean local `astro build`. |
| **Secrets never touch the repo** | The GitHub token is fine-grained, scoped to this single repo, Contents read/write only. Stored via Electron `safeStorage` (Windows DPAPI) — never in a file, never logged, never in a remote URL. It's handed to the push through an auth callback at call time, which is why the working copy has no remote configured at all. |
| **Electron security hygiene** | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. File and Git operations live in the main process behind a small IPC surface. The content view is restricted to localhost; external links are handed to the system browser. |
| **Mobile-first** | Phone layout designed first, scaled up. |
| **Pinned versions** | Astro 5.x, deliberately not 6/7. This stack moves quarterly; upgrades are chosen, never incidental. |

---

## Stack

Astro 5.18.2 (static) · Keystatic 0.5.50 (local mode, dev-only) · React 19 · Electron +
electron-builder (NSIS installer) · isomorphic-git · sharp · `@astrojs/mdx`, `@astrojs/sitemap`,
`@astrojs/rss` · self-hosted fonts via Fontsource · Node 24.18.0, pinned in `.nvmrc` and matched in
the Cloudflare Pages project.

## Layout

```
/                        Astro project root
  src/
    content/posts/<slug>/index.md    one folder per post, images colocated
    content/categories/<slug>.yaml   user-managed categories (data, not code)
    components/  layouts/  pages/  styles/
  content.config.ts      Astro schema      ─┐ same data, described from two
  keystatic.config.ts    editor schema     ─┘ directions — they move together
  astro.config.mjs       Keystatic integration is dev-only here
/studio                  the Electron app
ARCHITECTURE.md          the design document written before the code
```

The two schemas are the project's sharpest edge: they define the same content from opposite
directions, and changing one without the other breaks either the editor or the build. They're
edited as a pair, and a mismatch surfaces at the build gate rather than on the live site.

## Running it

```bash
npm install
npm run dev      # site at localhost:4321, editor at /keystatic
npm run build    # production static build — must pass before anything publishes
npm run preview  # serve the production build locally
```

The Studio app: `cd studio && npm start` for development, `npm run dist` to build the Windows
installer.

---

## How this was built

I designed and specified this system — the architecture, the constraints, the publish pipeline and
its failure behavior — and implemented it with AI assistance. I run and maintain it: I write the
posts, I operate the publish pipeline, and I'm the one who debugs it when it breaks.

[`ARCHITECTURE.md`](ARCHITECTURE.md) is the design document that preceded the code, including the
alternatives weighed and rejected — Tauri vs. Electron, Decap/Tina/Pages CMS vs. Keystatic, direct
Wrangler upload vs. a Git-backed publish — and the failure modes anticipated up front.

## Known limitations

Stated plainly, because they're real:

- **The site is early.** The design is done and the pipeline works end to end; the writing is still
  thin. That's the current work.
- **Single-machine by design.** Publishing assumes one laptop. There's a "remote is ahead" warning as
  cheap insurance, but no real multi-machine conflict resolution — scoped out deliberately rather
  than overlooked.
- **The project path has a hardcoded fallback.** `studio/main.js` falls back to a known absolute path
  when settings don't resolve. Fine for a single-user tool; wrong for anything distributed.
- **No automated tests.** Verification is the build gate plus manual checking. For a static site
  whose failure mode is "the build fails," that trade has held — but it is a trade.
