# Travel Customs — Architecture & Design Report
### Planning document · July 2026

> **What this is.** The design document written before any code: the reasoning behind the architecture, the alternatives weighed and rejected, and the failure modes anticipated up front. It is kept in the repository as the record of *why* the system is shaped the way it is. Where it differs from what shipped, what shipped wins — the visual direction in §3.2 was revised after the first build, and that note is inline.
>
> **On voice:** this was written as a requirements brief, in the third person, to pin down what the system had to do before any of it existed. The requirements are mine; the third person is just the register of the document.

---

## 1. Executive summary — what we are building

Jacob runs **Travel Customs**, a budget-friendly U.S. family travel blog. He has a previous Astro build he dislikes and wants replaced from scratch. Two things get built here, and they are designed to work as one system:

1. **The website** — a brand-new, professionally designed Astro 5 static site that looks like a modern, popular travel blog (photography-forward, clean, editorial, mobile-first). It is a pure static site: fast, cheap, secure, no database, no server.

2. **Travel Customs Studio** — a real double-click **desktop app** (Electron) that lives on Jacob's Windows PC. Inside it he writes posts (titles, body, images, categories), previews the whole site exactly as it will look live, and presses one **Publish** button. Publishing safely pushes his changes to the internet automatically.

The core design principle for the whole system is: **routine publishing must not require a terminal, a hand-run Git command, or a config edit — and no single wrong click may break the live site.** Everything operational sits behind three actions: **Write, Preview, Publish.**

The second principle is **maximum reuse of battle-tested tools.** We do not hand-roll a CMS, a Markdown editor, an image pipeline, or a deploy system. We assemble proven pieces (Astro + Keystatic + Git + Cloudflare Pages) and wrap them in a friendly shell. This is what keeps the system reliable and maintainable by one person.

**Decisions locked before the build:**
- Site is being built **fresh** — no migration from the old site, no attachment to the old design.
- The editing tool must be a **real installable desktop app with an icon he double-clicks** — not a browser tab, not a command he runs.
- Publishing should use the **safest easy option**; the exact mechanism was left open for the design to settle. The recommendation below (local preview + versioned Git publish + one-click rollback) is that answer.
- **Domain:** **thetravelcustoms.com**, registered through **Cloudflare Registrar** so domain, DNS, and hosting live in one dashboard. (The original target, `travelcustoms.com`, was already taken.)
- **Accounts:** he **has GitHub**; he does **not** have Cloudflare yet — the first-run setup must walk him through creating Cloudflare and connecting the repo.
- **One computer:** he publishes only from his **personal laptop**. Single-machine — the two-machine conflict risk is effectively moot (keep a light "pull on launch" as cheap insurance, but don't over-engineer for it).
- **Design direction:** editorial — charcoal text, one restrained accent, a refined serif display face. First pass is a draft to iterate on, not a delivery. (Revised after the first build — see §3.2.)
- **Categories:** keep the four (Budget Guides, Road Trips, Theme Parks, City Guides) **but they must be editable (add/edit/remove) inside the Studio app.** This makes categories **data, not code** — see §4.1. This is a real requirement, not a nice-to-have.
- **Newsletter:** **none at launch.** Don't build the signup. Leave the layout able to accommodate one later, but nothing to wire up now.

---

## 2. The recommended architecture (read this twice)

```
┌─────────────────────────── JACOB'S WINDOWS PC ───────────────────────────┐
│                                                                          │
│   TRAVEL CUSTOMS STUDIO  (Electron desktop app — the icon he clicks)     │
│   ┌──────────────┬──────────────┬───────────────────────────────────┐   │
│   │   WRITE tab  │  PREVIEW tab │            PUBLISH button          │   │
│   │  (Keystatic  │  (the real   │  1. builds the site locally        │   │
│   │   editor UI) │   site, live │  2. if build OK → commit + push    │   │
│   │              │   rendering) │  3. shows status + "live" link     │   │
│   └──────┬───────┴──────┬───────┴──────────────────┬────────────────┘   │
│          │              │                          │                    │
│          ▼              ▼                          ▼                    │
│   ┌──────────────────────────────┐        ┌─────────────────────────┐   │
│   │  The Astro project (bundled) │        │  isomorphic-git         │   │
│   │  • src/content/posts/*.md    │        │  pushes commits to      │   │
│   │  • images colocated          │───────▶│  GitHub over HTTPS      │   │
│   │  • Keystatic (local mode)    │        │  using a stored token   │   │
│   │  • runs `astro dev` inside   │        └───────────┬─────────────┘   │
│   └──────────────────────────────┘                    │                 │
│   GitHub token stored via Electron safeStorage (Windows DPAPI-encrypted)│
└───────────────────────────────────────────────────────┼─────────────────┘
                                                         │  git push
                                                         ▼
                                          ┌──────────────────────────────┐
                                          │  GitHub repo (private)       │
                                          │  = full version history &    │
                                          │    off-machine backup        │
                                          └───────────────┬──────────────┘
                                                          │ push triggers build
                                                          ▼
                                          ┌──────────────────────────────┐
                                          │  Cloudflare Pages            │
                                          │  • runs `astro build`        │
                                          │  • deploys to global edge    │
                                          │  • thetravelcustoms.com live │
                                          │  • 1-click rollback,         │
                                          │    per-branch previews, free │
                                          │    HTTPS                     │
                                          └──────────────────────────────┘
```

**The whole thing in one sentence:** The Studio app is a friendly window over an Astro project; when Jacob hits Publish, it validates a build, commits his work to GitHub (his safety net and backup), and Cloudflare Pages automatically rebuilds and deploys the live site.

### Why each piece was chosen

| Layer | Choice | Why this and not the alternatives |
|---|---|---|
| Site framework | **Astro 5** (static output) | Jacob already uses it; best-in-class for content sites; pure-static means fast, free, and nothing to hack. Astro's `<Image>` gives automatic image optimization. Stay on **Astro 5 (stable)**, not Astro 6 (beta as of early 2026). |
| Content editor | **Keystatic** (local mode) | *First-party* Astro integration. Runs a polished admin UI at `/keystatic` that writes Markdown files **directly to disk**. No database, free, MIT-licensed. It is purpose-built for exactly this ("content management for your codebase"). Alternatives (Decap, Tina, Sveltia, Pages CMS) are heavier or need a database/cloud auth; Pages CMS specifically requires a D1/Postgres database, which defeats the "no server" goal. |
| Desktop shell | **Electron** | The app's entire job is running Node tooling (Astro dev server, Keystatic, git). Electron **ships Node in the main process**, so spawning those tools is native and reliable. Tauri is smaller/faster but its Rust core would force us to bundle Node as a compiled "sidecar" (per-architecture binaries via `pkg`) — more moving parts, more ways for a solo maintainer's build to break. For a single-user tool run occasionally, Electron's ~150 MB size and RAM use are irrelevant; **reliability and buildability win.** |
| Git in the app | **isomorphic-git** (pure JS) | Lets the app push to GitHub **without requiring the user to install Git**. Keeps the "double-click, it just works" promise. (Fallback: bundle a portable Git and drive it with `simple-git` if isomorphic-git struggles with the repo — see §8.) |
| Hosting / deploy | **Cloudflare Pages** (Git-connected) | For a content-first static blog this is the simplest safe path: connect the GitHub repo once, every push auto-builds and deploys, **free per-branch preview URLs, and one-click rollback to any previous deployment.** Free tier, free HTTPS, generous limits. Note the 2026 context: Cloudflare is steering *new* projects toward "Workers + Static Assets," and Pages is being folded into that platform — but Pages remains fully supported and is still the least-friction choice for a pure static site. If we ever need server features, the forward path is Workers Static Assets. We do **not** need it now. |
| Credential storage | **Electron `safeStorage`** | Built in, no extra native dependency. On Windows it encrypts the GitHub token with **DPAPI** (tied to the user's login). Better than plaintext config and simpler than `node-keytar`. |
| Version control / backup | **GitHub (private repo)** | Doubles as the off-machine backup and the complete, revertible history of every post Jacob has ever published. This *is* the "safest" in "safest easy." |

---

## 3. The website design

Jacob asked the site to "follow popular travel blog websites." Research into current (2025–2026) travel-blog design and the blogs most often cited as best-in-class (Salt in Our Hair, Nomadic Matt, Along Dusty Roads, Indie Traveller, World of Wanderlust, Another Escape, Traveling Mitch, HeyCiara) converges on a consistent, repeatable pattern. Build to this pattern; do not invent something exotic.

### 3.1 Design principles that recur across the best travel blogs
- **Photography is the interface.** Big, warm, well-graded images do the emotional work. The design's job is to *get out of the way* ("good design is invisible"). Generous white space; let images breathe.
- **Category-forward navigation.** The best blogs put their main categories near the top of the homepage ("above the fold"), like a store puts departments up front. For Travel Customs the starting four are **Budget Guides, Road Trips, Theme Parks, City Guides** — but these are **user-managed** (Jacob adds/edits/removes them in the Studio app), so the nav and homepage strip must render from live data, not a hardcoded list, and degrade gracefully as the count grows (a "More ▾" overflow if needed). See §4.1.
- **A clean editorial type system.** The common recipe: a characterful **serif or display face for headlines** + a highly readable **sans-serif for body**. One accent color, restrained. Avoid template-y default styling.
- **Scannable practical content.** Family/budget travel is decision-driven. Readers want *timing, effort level, budget range* fast. Surface "quick facts" early in each post.
- **Trust signals.** An author face/bio, an About page with a real story, consistent voice. This is what separates a blog people return to from a content farm.
- **Newsletter capture.** *(Deferred by Jacob — not built at launch.)* Email signup is the single most valuable long-term conversion for a blog, so leave a tasteful spot for it in the layout (footer and an inline mid-content slot) that renders nothing for now and is easy to switch on later.
- **Mobile-first, always.** Most travel-blog readers arrive on phones from Google. Design the phone layout first, scale up to desktop. Jacob has repeatedly emphasized mobile-first — honor it.

### 3.2 Visual direction — editorial (as shipped)

The planning draft called for a warm cream canvas. **Reviewing the first build changed that decision:** cream read as dated next to the photography, so the canvas became pure white and the accent a deep sea-blue rather than terracotta. What shipped:

- **Feel:** calm, premium, timeless — photography leads and the chrome recedes.
- **Palette:** **pure white** canvas, charcoal text, **one** accent (**deep sea-blue**), used sparingly.
- **Type:** a refined **serif display face** for headlines (Fraunces) + a highly readable **sans-serif** for body (Source Sans 3), both self-hosted. Real hierarchy, not template defaults.
- **Homepage:** leads with a centered site-title masthead; the featured article sits below it, secondary.

The first build was treated as a draft and revised from live preview. Content and styling stay cleanly separated, so a restyle never touches the posts.

### 3.3 Page & component inventory (what to build)
**Pages / routes**
- **Home** — hero (featured post or rotating featured), category strip (from the live categories data), latest posts grid, a "start here"/popular block, footer. *(No newsletter block at launch — leave a quiet slot.)*
- **Post (article) template** — hero image + title + meta (date, category, read time); **"Trip at a glance" quick-facts box** (budget range, duration, best season, who it's for); body with good typography; optional modules Jacob's content uses (day-by-day itinerary, where-to-stay cards, budget breakdown table, pull-quotes); author bio; "Read next" related posts. *(No newsletter block at launch.)*
- **Category pages** — **generated dynamically from the categories data** (§4.1), one page per category, showing that category's posts in a grid with a short intro. Adding a category in Studio creates its page automatically.
- **About** — Jacob's story and face; the "why Travel Customs" and the double meaning of "customs."
- **Contact / basic pages** — contact, plus room for privacy policy (needed if he adds ads/affiliates).
- **404** and **sitemap.xml** and **RSS feed** (RSS is cheap and valued by travel readers).

**Reusable components** (Jacob's old project already had good bones here — mirror the concept, rebuild the styling): `Header/Nav`, `Footer`, `PostCard`, `CategoryStrip`, `QuickFactsBox`, `ItineraryDay`, `StayCard`, `BudgetTable`, `PullQuote`, `AuthorBio`, `RelatedPosts`, `BaseHead` (SEO/meta). *(A `Newsletter` component is deferred — build the empty slot only.)*

### 3.4 SEO (this is the growth engine — do not skip)
Travel blogs live or die by Google. Astro static output is already excellent for this. Ensure:
- Semantic HTML, one `<h1>` per page, proper heading order.
- Per-post `<title>` + meta description + Open Graph/Twitter card image (so shared links look good).
- **JSON-LD structured data** (`Article`/`BlogPosting`, `BreadcrumbList`) in the post template.
- `sitemap.xml` (via `@astrojs/sitemap`) and a `robots.txt`.
- Descriptive image `alt` text (Keystatic schema should include an alt field per image — make it required).
- Fast Core Web Vitals: use Astro's `<Image>` everywhere (auto WebP, responsive `srcset`, width/height set to prevent layout shift). Cloudflare's edge caching handles the rest.
- Human-readable slugs (e.g. `/posts/oregon-coast-road-trip-budget`).

### 3.5 Monetization-ready (design for it now, enable later)
Jacob's earlier brief reserved ad space in the margins and he has long-term monetization interest. Don't bolt ads on now, but **leave the seams**: define slots in the layout (e.g. an in-content ad component and a sidebar/footer slot) that render nothing until enabled, and keep affiliate-link and disclosure patterns in mind. Ads/affiliates typically require a privacy policy and an affiliate-disclosure line — hence the basic legal pages above.

---

## 4. The content model (how a post is stored)

**One post = one folder** under `src/content/posts/`, containing an `index.md` (or `.mdoc`) plus its images colocated in the same folder. This keeps each post self-contained and portable, and lets Astro optimize the images (anything in `src/` is optimized; anything in `public/` is **not**).

**Two schemas must agree** and this is a classic footgun (see §8):
1. **Astro content-collection schema** (`src/content.config.ts`) — validates frontmatter and types the data for the site.
2. **Keystatic schema** (`keystatic.config.ts`) — defines the editor fields Jacob sees.

They describe the same data from two directions. **If you change one, you must change the other**, or the editor and the site fall out of sync.

**Frontmatter fields (starting set — refine the optional modules during Phase 1/3):**
`title`, `slug` (auto from title), `publishDate`, `category` (**a reference to a category entry, NOT a hardcoded enum** — see §4.1), `heroImage` (+ required `heroAlt`), `excerpt/description`, `draft` (boolean — drafts don't publish), plus optional structured fields for the travel modules (budget range, duration, season, itinerary items, stay cards). Keep the required set small so writing stays fast; make the rich modules optional.

**Content field:** use `fields.mdx({ extension: 'md' })` in Keystatic so it reads/writes plain Markdown with a `.md` extension and stays compatible with normal Markdown posts. (Keystatic's valid content fields are `document`, `mdx`, or `markdoc` only.)

### 4.1 Categories are DATA, not code (user-managed in Studio)
Jacob requires the ability to add, edit, and remove categories from inside the Studio app **without touching code.** That rules out the simple approach of a hardcoded `enum` in the schemas (changing an enum is a code edit). Instead:

- **Categories become their own Keystatic collection**, e.g. `src/content/categories/<slug>.yaml`, each entry with: `name` (display), `slug` (drives the URL, e.g. `/category/road-trips`), `description`, and optionally an accent/cover image. Jacob manages these in a "Categories" section of the editor.
- **A post's `category` field is a Keystatic `fields.relationship`** pointing at that categories collection — so when writing a post he picks from a **dropdown of his current categories**, and any category he just added appears automatically. (A `fields.select` won't work here: its options are fixed at config-load time and can't read live data. `relationship` is the right tool.)
- **The Astro side reads the categories collection** to (a) generate one category page per entry via a dynamic route, and (b) build the nav and homepage category strip. Add a category → its page, nav link, and strip entry appear on the next publish, with zero code changes.
- **The post's Astro schema validates `category` as a reference/string** (the category slug), not a static enum. A build-time check confirms every post's category still exists.

**Guardrails to build (so this power can't cause quiet breakage):**
- **Delete-with-posts:** deleting a category that still has posts must **warn Jacob first** in the app ("3 posts use this category — reassign them first?") and ideally offer to reassign or block until reassigned. The **build gate** is the backstop: a post pointing at a deleted category fails the local build, so publishing is blocked with a plain-English message before anything reaches the live site.
- **Slug changes:** renaming a category's *display name* is safe. Changing its *slug* changes that category's URL and breaks old links — the app should keep the slug stable after creation, or warn clearly and (better) drop a redirect. Prefer "name is editable, slug is set once."
- **Nav overflow:** the header/nav and homepage strip must handle a growing number of categories gracefully (wrap or "More ▾"), since Jacob controls the count.

This is a modest amount of extra structure (a collection, a relationship field, a dynamic route, two guardrails) in exchange for exactly the self-service Jacob asked for. Build it in Phase 3 alongside the editor.

---

## 5. The publishing pipeline (the "safest easy option," specified)

This is the specified publishing mechanism. It layers three independent safety nets so that no single mistake can take down the live site or lose work.

**Step by step, what happens when Jacob clicks Publish:**
1. **Local build gate.** The app runs `astro build` on his machine first. If the build fails (e.g. a broken image reference or a bad field), **publishing aborts** and the app shows a plain-English message ("This post has a problem and wasn't published — [detail]. Nothing on your live site changed."). *A broken draft can never reach the internet.*
2. **Commit.** On success, the app stages all changes and makes a Git commit with a friendly auto-message (e.g. `Publish: "Oregon Coast on a Budget" — 2026-08-02`). This is the **version-history safety net**: every publish is a labeled, restorable snapshot.
3. **Push.** The app pushes the commit to the private GitHub repo over HTTPS using the stored token (isomorphic-git). GitHub is now the **off-machine backup**.
4. **Auto-deploy.** Cloudflare Pages sees the push, runs its own build, and deploys to `thetravelcustoms.com`. The app shows "Publishing… live in about a minute" and then the live link. Typical time: ~1–2 minutes.
5. **Rollback available.** If Jacob ever dislikes what went live, the Cloudflare dashboard offers **one-click "Rollback to this deployment"** to instantly restore the previous version, and the Git history lets us revert any commit. The app can surface a simple "Undo last publish" that does this.

**Why not simpler/faster options?**
- *Direct upload with Wrangler (no Git):* faster, but throws away version history and backup — less safe. We keep Git precisely because Jacob asked for "safest."
- *A staging branch + manual promote:* safest of all, but adds a step Jacob didn't ask for. The **local preview** already lets him see exactly what will ship, so we get "preview before publish" for free without the extra branch dance. (If he later wants a true staging URL, Cloudflare's automatic per-branch previews make that a small addition.)

**Preview, precisely:** The Preview tab shows the real site rendered locally (via the running `astro dev` server, or a local `astro build && astro preview` for a production-accurate view). What he sees is what deploys.

---

## 6. Security & privacy notes
- The GitHub token must be a **fine-grained Personal Access Token scoped to the single Travel Customs repo**, with only Contents read/write. Never a classic all-repo token. Store it with `safeStorage`; never write it to a plain file or log it.
- The repo should be **private** (Jacob's drafts, notes, and unpublished ideas live there).
- The Cloudflare API is **not** needed by the app for the recommended pipeline (Cloudflare deploys off the GitHub push). Fewer secrets on the machine = safer.
- The app performs privileged actions (writing files, pushing to GitHub). Follow Electron security hygiene: `contextIsolation: true`, no `nodeIntegration` in the renderer, all file/git operations in the main process behind a small IPC surface, and the Keystatic/Astro UI loaded from `localhost` (not remote content).

---

## 7. End-to-end lifecycle — creating and maintaining Travel Customs

**One-time setup (done with Jacob, guided by the app's first-run wizard):**
1. Create a private GitHub repo; the app helps generate/paste the fine-grained token.
2. Create a Cloudflare account; connect the GitHub repo as a Pages project (build command `astro build`, output `dist`).
3. Register the domain (Namecheap/Porkbun/Cloudflare Registrar, ~$10–12/yr) and point it at the Pages project. Free HTTPS is automatic.
4. Install the Studio app (double-click installer).

**Everyday use (the loop Jacob actually lives in):**
- Open Studio → **Write** → "New Post" → type title/body, drag in photos, fill quick-facts, set category → save (writes to disk).
- **Preview** → scroll the real site on desktop and phone widths.
- Happy? **Publish** → wait ~1 minute → it's live. Not happy? Keep editing; nothing is public until he publishes.

**Editing/unpublishing:** open the post in Write, change it, Publish again (new versioned commit). To pull a post down, set `draft: true` (or delete) and Publish. To undo a publish, use "Undo last publish" (Cloudflare rollback / Git revert).

**Maintenance (low, but real):**
- **Backups:** automatic — every publish is in GitHub. Optionally the app can also zip the project to a local folder on publish.
- **Dependency updates:** occasional. Pin versions (see §9) so nothing changes unless we choose. Plan a light "update check" a couple of times a year, tested on a branch/preview before it touches the live pipeline.
- **The app itself:** if Jacob only runs it on one PC, updates can be "download the new installer." If he wants auto-update later, that's an add-on (electron-updater), not a launch requirement.

---

## 8. Challenges, risks & mitigations (anticipate these — do not discover them live)

| # | Challenge / failure mode | Why it happens | Mitigation to build in |
|---|---|---|---|
| 1 | **Two schemas drift** (Keystatic ≠ Astro collection) | They're defined separately; changing one and not the other breaks the editor or the build. | Treat them as a pair. Add a short comment in each pointing to the other. In the build gate, a schema mismatch surfaces as a build error *before* publish, not on the live site. Keep the field list documented alongside the schemas. |
| 2 | **Keystatic breaks the production static build** | Keystatic injects server routes; a pure static build (no adapter) can choke on them. | Include Keystatic **only in dev**, exclude it from the production build (conditional integration on an env flag), so the deployed site is pure static with no adapter. **Verify** the production `astro build` is clean and static. Do not switch the site to `output: 'server'`. |
| 3 | **Giant phone photos bloat the repo & slow builds** | Originals are 3–6 MB; a photo-heavy post × many posts = a huge repo and long Cloudflare builds (image optimization runs at build time and scales with image count/size). | The Studio app **resizes/compresses images on import** (cap long edge ~2000px, convert to WebP, strip EXIF) before Keystatic saves them. Repo stays lean; builds stay fast; Astro still generates responsive sizes at build. |
| 4 | **A bad post reaches the live site** | Broken link/image/frontmatter. | The **local build gate** (Step 1 of publish) blocks it. Live site only ever updates from a build that already succeeded locally. |
| 5 | **Bundling Node/running `astro dev` inside Electron is fragile** | Electron's Node vs the project's tooling, `ELECTRON_RUN_AS_NODE`, spawning child processes, path issues on Windows. | Prototype this **first** (build plan Phase 3, thin vertical slice). Ship the Astro project with its `node_modules` **inside** the app bundle so there's no `npm install` on the user's machine. Documented fallback: a first-run step that installs a pinned Node if in-bundle Node proves unreliable. |
| 6 | **Publish fails midway** (network drop during push) | Internet flakiness. | Make publish idempotent and resumable: commit locally always succeeds (work is saved); push retries; clear status ("Saved locally, but couldn't reach GitHub — retry?"). Never leave Jacob unsure whether his work is safe. |
| 7 | **Editing from two machines causes a Git conflict** | Two PCs both push. | **Confirmed: Jacob uses one laptop only**, so this is effectively moot. Keep the cheap insurance anyway — on launch the app **pulls first** and warns if the remote is somehow ahead — but don't over-engineer for multi-machine. |
| 8 | **Token leaks or expires** | Stored badly, or fine-grained tokens expire. | `safeStorage` + fine-grained, repo-scoped token. On auth failure, the app prompts to re-enter — it never hard-crashes. Never log the token. |
| 9 | **Cloudflare build succeeds locally but fails on their runner** | Env differences (Node version, Sharp availability). | Pin the Node version in the Pages project settings to match local. Keep the build pure-static (no exotic adapters). The local gate catches ~all content errors; env drift is caught by watching the first deploy after any dependency change. |
| 10 | **Dependency updates silently break things** | Astro/Keystatic/Electron move fast; Astro 6 beta, Keystatic edge cases where docs lag Astro 5. | **Pin every version.** Only update deliberately, on a branch, verified against a Cloudflare preview deploy before merging. Known-good versions are recorded in the README. |
| 11 | **Domain lapse or DNS misconfiguration** | Registrar/DNS is the one genuinely fiddly one-time step. | The first-run wizard gives exact, screenshot-level steps. Cloudflare Registrar keeps domain + hosting + DNS in one dashboard, which is the least confusing option. |
| 12 | **He wants a design change after launch** | He explicitly plans to iterate on design. | Because content and presentation are cleanly separated (Markdown content vs. Astro components/CSS), restyling never risks the content. Design changes are a code branch → preview → merge, and never touch his posts. |
| 13 | **App feels slow to start** (spinning up Astro dev) | Dev server boot time. | Show a friendly splash/loading state; keep the server warm while the app is open; consider a lightweight "content list" view that loads instantly while the editor/preview warms up. |
| 14 | **User-managed categories orphan posts or break URLs** | Jacob deletes a category still in use, or changes a category's slug. | See §4.1 guardrails: **warn before deleting** a category with posts (offer reassign); **keep slugs stable after creation** (name stays editable) or warn + add a redirect on slug change; the **build gate** blocks publishing any post whose category no longer exists, with a plain-English message. |

---

## 9. Recommended stack & pinned versions (confirm latest-stable at build time)

- **Astro 5.x** (stable; **not** 6 beta) — static output, `@astrojs/sitemap`, `@astrojs/rss`, `@astrojs/mdx`, Astro `<Image>`/assets.
- **Keystatic** (`@keystatic/core`, `@keystatic/astro`) — local storage mode; content field `fields.mdx({ extension: 'md' })`; dev-only integration.
- **Electron** (current stable) + **electron-builder** (Windows NSIS installer → the double-click icon; optionally a portable `.exe`).
- **isomorphic-git** for push (fallback: bundled portable Git + `simple-git`).
- **sharp** for on-import image resizing in the app (and it's what Astro uses at build).
- **Node.js** pinned (match Astro's requirement, ≥ 18.17.1 for Astro 5; a current LTS is safest) — both in the app bundle and in the Cloudflare Pages project settings.
- Hosting: **Cloudflare Pages**, Git-connected. Build command `astro build`, output dir `dist`.

> Before installing anything, **check each package's current stable version and its own docs** — this ecosystem moves quarterly and some Keystatic docs lag Astro 5. Do not trust memorized version numbers.

---

## 10. Decisions settled before the build

These were settled up front so the build could proceed without re-litigating them.

1. **Domain:** **thetravelcustoms.com**, via **Cloudflare Registrar** — one dashboard for domain, DNS, and hosting.
2. **Accounts:** **has GitHub; needs Cloudflare.** The first-run setup walks him through creating Cloudflare and connecting the repo. He does the account creation himself; you guide.
3. **Design:** editorial (§3.2). First pass is a draft; iterate from live preview.
4. **Categories:** keep the four to start, but **user-managed in Studio** (add/edit/remove) → categories are data, not code (§4.1).
5. **One computer:** personal laptop only. Don't over-engineer multi-machine.
6. **Newsletter:** **not at launch.** Leave a layout slot; build nothing.

**The only remaining items are one-time account actions:** register the domain, create the Cloudflare account, and generate the fine-grained GitHub token. Everything else is decided.

---

## 11. Recommended build plan (phased, verify each phase before moving on)

Build in thin, verifiable slices. Each phase ends in something runnable that can be seen and judged, rather than a single reveal at the end.

- **Phase 1 — Site skeleton.** New Astro 5 project, posts + **categories** content collections, schemas, 2–3 sample posts, all routes (home, post, **dynamic category pages**, about, 404), sitemap/RSS. Pure static build succeeds. *Deliverable: a running local site with placeholder styling.*
- **Phase 2 — Design.** Implement the editorial direction as real components + CSS, mobile-first. Review from a live preview and iterate on the details (accent color, type, spacing). *Deliverable: the site reads as a real travel blog, not a template.*
- **Phase 3 — Editing layer + category management.** Add Keystatic (local, dev-only), mirror the schema, add the **categories collection** and the post→category **relationship** dropdown, and the **delete/slug guardrails** (§4.1). Confirm writing a post *and* adding/removing a category in the admin UI both work and render correctly. *Deliverable: he can write a post and manage his categories in the admin, and see it all appear.*
- **Phase 4 — The Studio shell (thin slice).** Electron app that boots, spawns the Astro/Keystatic dev server, and shows Write + Preview tabs pointed at localhost. Prove the fragile part (§8 #5) early. *Deliverable: the double-click app opens and he can write + preview inside it.*
- **Phase 5 — Publishing.** Add the image-on-import resizer, the build gate, commit/push via isomorphic-git, token storage via safeStorage, and wire the Publish button + status + "Undo last publish." *Deliverable: he clicks Publish and it goes live.*
- **Phase 6 — Deploy pipeline & domain.** Cloudflare Pages connected to the repo, custom domain, HTTPS, confirm rollback works. *Deliverable: thetravelcustoms.com is live and the loop works end to end.*
- **Phase 7 — Packaging & polish.** electron-builder installer (the real icon), first-run setup wizard, friendly error messages, README. *Deliverable: a self-installing app a non-technical person could run.*

---

## 12. Cost summary
- **Domain:** ~$10–12/year (the only guaranteed cost).
- **Hosting (Cloudflare Pages):** $0 on the free tier for a site this size.
- **GitHub:** $0 (private repos are free).
- **Keystatic / Astro / Electron / all tooling:** $0 (open source).
- **Newsletter (optional):** $0 to start on a free tier.

**Total realistic run cost: about $10–12/year.** No servers, no database, no monthly SaaS.

---

## 13. Sources consulted (for the human, not for code)
Travel-blog design: bucketlistly.blog "24 Gorgeous Travel Blogs"; webyking.com and mediaboom.com travel-website roundups; sitebuilderreport.com blog-design examples; designmonks / unicornplatform 2026 travel design trends.
Content editor: docs.astro.build Keystatic guide; keystatic.com docs; luckymedia.dev and makerstack.co Keystatic reviews; quevin.ai Keystatic+Astro 5 field notes (the gotchas).
Desktop shell: tauri.app sidecar docs; dolthub, gethopp, openreplay, buildmvpfast Tauri-vs-Electron comparisons (2025–2026).
Hosting: developers.cloudflare.com (Pages→Workers migration, Astro on Workers, Static Assets); mecanik.dev and jjaimealeman.com "Pages vs Workers 2026."
Security: electronjs.org safeStorage docs; cameronnokes / freek.dev credential-storage write-ups.
Images: docs.astro.build images & content-collections; astro.build images blog.
