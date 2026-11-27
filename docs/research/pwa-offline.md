# PWA and offline-first on Next.js and Vercel

Research for issue #24. Question: what does it take to make dictio an
installable, offline-first PWA on the Next.js version in this repo (16.4.6, App
Router, Turbopack, `cacheComponents` and `partialPrefetching` on), deployed to
Vercel Hobby, with all user data in the browser?

Researched 2026-11-27. Sources are listed at the end; bracketed numbers refer to
them.

## Short answer

- **Installable** takes a web app manifest plus HTTPS. Next.js has this built
  in (`app/manifest.ts`), and Vercel serves HTTPS. No service worker is needed
  just to be installable [1][2][9].
- **Offline-first**, meaning a cold start or a full reload with no network,
  needs a service worker. Next.js does not ship one. Its docs point to
  **Serwist**, and Serwist has a Turbopack integration (`@serwist/turbopack`)
  that suits this repo [1][3][5].
- Next.js's own experimental `useOffline` only covers soft navigations and
  Server Actions inside an already loaded page. It does not cover a full page
  load offline [4].
- **IndexedDB** (the user's glossaries) and the **Cache API** (the app shell,
  WebLLM weights) live in the same per-origin quota and are evicted together,
  all or nothing [6][7].
- **iOS has the biggest surprise.** A Home Screen web app has storage isolated
  from Safari. Data entered in Safari does not appear in the installed app, so
  export/import is the only bridge [10][11].
- **Installing helps data survive.** On iOS it effectively removes the Safari
  7-day eviction risk and is a heuristic for granting `persist()`. In Chromium,
  installing is one heuristic for granting `persist()`. It does not change the
  quota on any platform [6][7][8][12].

## 1. What Next.js provides (version-matched docs)

### Manifest

- `app/manifest.ts` (or `.json` / `.webmanifest`) at the root of `app/`
  generates the manifest. `manifest.ts` is a special Route Handler, cached by
  default, so on Vercel it is a static file [2].
- The PWA guide's example sets `name`, `short_name`, `start_url`,
  `display: 'standalone'`, colours and 192 px / 512 px icons, which put in
  `public/` [1].
- The guide says that with a valid manifest and HTTPS, "modern browsers will
  automatically show an installation prompt". It **advises against** a custom
  `beforeinstallprompt` button because that is "not cross browser and platform
  (does not work on Safari iOS)" [1].

### Service worker

- The guide's only service worker is a hand-written `public/sw.js`-style file
  for **push notifications**. It has no caching. It shows how to register one
  (`navigator.serviceWorker.register(..., { scope: '/', updateViaCache: 'none' })`)
  and suggests headers for `/sw.js`: `Cache-Control: no-cache, no-store,
must-revalidate`, `Content-Type: application/javascript`, and a strict CSP
  [1].
- For "full service-worker-based offline caching" the guide names **Serwist**,
  with examples for both Turbopack and webpack [1].
- Push needs a server, VAPID keys and stored subscriptions, which conflicts
  with browser-only data and no accounts. dictio would leave it out.

### `experimental.useOffline` and `useOffline()` (new in 16.x, experimental)

- When this is on, a failed navigation, prefetch or Server Action does not
  throw while offline. It stays pending and retries when the connection
  returns. Connectivity is detected with `offline`/`online` events plus `HEAD`
  polling (500 ms, then 1 s, 2 s, and 3 s from then on, with no limit). The
  `useOffline()` hook from `next/offline` exposes the offline state [3][4].
- The App Shell of a prefetched `<Link>` target renders offline, thanks to
  Cache Components and Partial Prefetching, which this repo already enables
  [3].
- The limit, quoted from the docs: "A full page reload while offline still
  fails because the browser needs the network to deliver the HTML; full offline
  loads would need a service worker" [3].
- For dictio this matters less, because data does not come from the server.
  `useOffline()` is still a cheap way to show an "offline" indicator. It is
  experimental.

### Static export

- `output: 'export'` is possible: there is no server to depend on. It disables
  `headers()`, rewrites, Proxy, Server Actions, the default image loader, and
  dynamic routes without `generateStaticParams` [13].
- It would make every HTML file a precacheable static asset. It is not
  required, though: with Serwist on a normal Vercel build, prerendered routes
  are already static.

### Bundler

- Turbopack is the default bundler for `next build` since v16.0.0 [14]. This
  is why `@serwist/next`, the webpack plugin, is the wrong fit and
  `@serwist/turbopack` is the right one.

## 2. Serwist (the library the Next.js docs point to)

Serwist is a maintained fork of Workbox [5]. Current version is 9.6.0 for
`serwist`, `@serwist/turbopack` and `@serwist/next`. `@serwist/turbopack`
declares the peers `next >=14`, `react >=18`, `esbuild` or `esbuild-wasm`, and
`typescript >=5` (checked with `npm view`).

Turbopack setup, according to the Serwist docs [5]:

1. Install `@serwist/turbopack`, `serwist` and `esbuild` as dev dependencies.
   Wrap `next.config` with `withSerwist`.
2. Add a route handler, `app/serwist/[path]/route.ts`, that exports
   `createSerwistRoute({ swSrc: 'app/sw.ts', additionalPrecacheEntries, useNativeEsbuild: true })`.
3. Write the worker in `app/sw.ts` with `new Serwist({ precacheEntries: self.__SW_MANIFEST, runtimeCaching: defaultCache, fallbacks, ... })`.
4. Register it by wrapping the layout in
   `<SerwistProvider swUrl="/serwist/sw.js">` from `@serwist/turbopack/react`.

What the package source (v9.6.0) does:

- **Route.** The route is `force-static` with `generateStaticParams`, so on
  Vercel the worker is a static build output. esbuild bundles it at build
  time, and the precache manifest is inlined. The response sets
  `Service-Worker-Allowed: /`, which a worker under `/serwist/` needs to
  control scope `/` [15].
- **Precache.** The default precache globs are
  `.next/static/**/*.{js,css,html,ico,png,svg,webp,json,webmanifest,...}` and
  `public/**/*`. **Prerendered page HTML and RSC payloads are not precached by
  default.** Only the extra entries you list are added, for example
  `/~offline` with a `revision`.
- **Runtime cache.** `defaultCache` in production caches page HTML, RSC and
  RSC-prefetch responses `NetworkFirst`, each with
  `ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 86400 })`.
  **Cross-origin** requests go to a `NetworkFirst` "cross-origin" cache (32
  entries, 1 hour, 10 s timeout). `/_next/static` JS is `CacheFirst`.
- **Development.** In development `defaultCache` is `NetworkOnly` for
  everything, and the precache manifest is turned off. Offline behaviour can
  only be tested with `next build && next start`, which the Next.js offline
  guide also says [3].
- **Provider.** `SerwistProvider` by default registers a module worker, sends
  `CACHE_URLS` for each `pushState`/`replaceState` URL (`cacheOnNavigation`),
  and reloads when the connection returns (`reloadOnOnline`).
- **Revision.** The docs' example derives `revision` from `git rev-parse HEAD`
  [5]. On Vercel the documented, reliable value is `VERCEL_GIT_COMMIT_SHA`
  (also `VERCEL_DEPLOYMENT_ID`), which is available at build time [16].

**The alternative is a hand-rolled worker.** It is feasible, because the app
has no server data. But `/_next/static` filenames are content-hashed and change
on every build, so precaching them needs the build's file list, and producing
that list is the job Serwist does. A runtime-only worker (cache what you fetch)
would not work offline until every chunk had been visited online.

## 3. Caching strategy for the app shell

This is how the facts above combine for dictio. Here "shell" means all the
HTML, JS and CSS, since dictio has no server data at all.

- **Precache the whole app at install.** Precache `.next/static` and `public/`
  (Serwist's default) plus each route's HTML, added through
  `additionalPrecacheEntries` with `revision = VERCEL_GIT_COMMIT_SHA`. The app
  then works offline after the first visit, not only on pages already seen.
- **Do not rely on `defaultCache` for page HTML.** It expires after 24 hours,
  so after a day offline a page that was never precached falls through to the
  offline fallback (inferred from the `ExpirationPlugin` settings above).
- **Keep data out of URLs that need a server.** Glossary IDs exist only in
  IndexedDB, so a route like `/glossaries/[id]` cannot be prerendered for real
  IDs. An offline reload of `/glossaries/abc` needs a cached response for that
  exact URL. A static route that reads the ID from the client avoids the
  problem, for example a search param or a single shell page. Otherwise the
  worker must map every `/glossaries/*` navigation to one cached shell. This is
  a routing decision for a later ticket.
- **Updates.** `skipWaiting` plus `clientsClaim` (the Serwist template) moves
  open tabs onto the new worker at once. An "update available, reload" prompt
  is the safer pattern when cached chunks are swapped under a running page.
  Serwist's `@serwist/window` exposes the lifecycle events this needs [5]. The
  browser always checks the worker script itself against the network
  (`updateViaCache: 'imports'`/`'none'`) [15].

## 4. Interaction with IndexedDB and WebLLM weights

- **One quota, one fate.** IndexedDB, the Cache API, OPFS and Web Storage all
  count against one per-origin quota. Eviction is per origin and "all of its
  data, not parts of it, is deleted at the same time" [6]. The app shell and
  the user's glossaries are kept or lost together. "Clear site data" wipes
  both, which matches the standing constraint.
- **Quotas.** Chromium allows up to 60% of disk per origin. Firefox allows the
  smaller of 10% of disk or 10 GiB when best-effort, and 50% when persistent.
  Safari 17+ allows up to 60% of disk for browser apps and 15% for other apps
  (WKWebView), with an overall cap of 80%. Safari 17 no longer prompts for more
  space [6][7]. Quotas are an upper bound, so handle `QuotaExceededError` on
  every write [6][7].
- **How WebLLM caches.** WebLLM stores weights itself. It uses the Cache API by
  default, and `appConfig.cacheBackend` can be `"indexeddb"`, `"opfs"` or
  `"cross-origin"` (experimental Chrome). It has helpers to check for and
  delete cached models [17]. The prebuilt models download from a third-party
  host, so they are **cross-origin** requests.
- **What follows for the service worker (inferred):**
  - Do not precache weights. That would make the worker's install download
    gigabytes.
  - Exclude model and wasm URLs from Serwist's runtime caching. Use a
    `NetworkOnly` matcher placed before `defaultCache`, or a custom list.
    Otherwise the default "cross-origin" `NetworkFirst` rule would store a
    second copy of each shard, with a 1-hour expiry, beside WebLLM's own cache.
  - WebLLM's own cache already works offline once a model has been downloaded.
  - Weights are the largest thing in the origin. Under storage pressure, a
    best-effort origin loses its glossaries together with its weights. This is
    an argument for requesting `persist()`.
- **Persistence.** `navigator.storage.persist()` stops browser eviction. Data
  is then deleted only by the user [6][8].
  - Firefox shows the user a prompt [6].
  - Chromium decides silently, from engagement, from whether the site is
    "installed or bookmarked", and from notification permission [8].
  - Safari decides with heuristics "like whether the website is opened as a
    Home Screen Web App" [7].

## 5. Install support on iOS and Android

- **Android and desktop Chromium.** Chrome's install criteria:
  - The app is not already installed.
  - The user has clicked or tapped the page at least once and viewed it for at
    least 30 seconds.
  - HTTPS.
  - A manifest with `name` or `short_name`, 192 px and 512 px icons,
    `start_url`, a `display` of `standalone`, `fullscreen`, `minimal-ui` or
    `window-controls-overlay`, and `prefer_related_applications` not `true`.

  Once these are met, Chrome fires `beforeinstallprompt` and offers its own
  install UI. The criteria list no service worker [9]. Edge and Firefox have
  similar criteria [9]. On Android, the install can be a WebAPK, a shortcut or
  similar. Multiple shortcuts "use the same storage" [10].

- **iOS and iPadOS.** There is no install prompt. The user installs through
  Share, then Add to Home Screen [10][1].
  - Since iOS/iPadOS 26, **every** site added to the Home Screen opens as a web
    app by default. The user can turn off "Open as Web App". WebKit: "there are
    now zero requirements for 'installability' in Safari" [18].
  - `beforeinstallprompt` is not supported. An iOS-specific hint ("tap Share,
    then Add to Home Screen") is what the Next.js guide shows, gated on
    `display-mode: standalone` [1].
- **iOS storage is isolated.** "Each installation has its own isolated storage
  and is treated as a different application" [10]. A WebKit engineer on the
  long-open bug: "Home Screen apps are created as isolated entities without
  shared state with the browser" [11].
  - A user who builds glossaries in Safari and then installs starts with an
    empty app.
  - Deleting the Home Screen icon presumably deletes that app's data. The
    sources do not state this explicitly; web.dev notes that on desktop
    "deleting the icon may not clear the storage" [10].

## 6. Does installing change how much storage is kept, or for how long?

- **How much: no.** Safari: "a standalone web app ... has the same origin and
  overall quota as when opened in a browser app" [7][6]. Chromium's quota is
  the same in best-effort and persistent mode (60%) [6]. None of the sources
  give installed apps a larger quota.
- **How long: yes, indirectly.**
  - **Safari's ITP 7-day rule.** If an origin has had no user interaction in
    the last 7 days of browser use, its script-written storage is deleted.
    That covers IndexedDB, localStorage, and service worker registrations and
    caches [6][12].
  - Home Screen web apps "have their own counter of days of use". WebKit says
    it does not expect first-party data in such apps to be deleted, and would
    treat that as a serious bug [12].
  - So in Safari (not installed), a user who doesn't open dictio for 7 days of
    browsing can lose everything. Installed, they effectively don't.
  - **`persist()`.** Installing is a granting heuristic in both Safari [7] and
    Chromium [8], and persistent origins are exempt from pressure eviction [6].
  - **Without persistence,** origins are evicted least-recently-used under
    storage pressure in all browsers. Chrome reports this is "very rarely" done
    [6].

## Recommendation (input for a later decision ticket, not a decision)

> **Recommendation:** PWA/offline-first is feasible on this stack at no cost on
> Vercel Hobby, and browser storage supports it.
>
> 1. Add `app/manifest.ts` and icons first. This alone makes the app
>    installable, and it is low-risk.
> 2. Add **Serwist via `@serwist/turbopack`**. Precache `.next/static`,
>    `public/` and every route's HTML, with `revision` from
>    `VERCEL_GIT_COMMIT_SHA`. Add an offline fallback page, and a "new version,
>    reload" prompt instead of a silent `skipWaiting`.
> 3. Keep routes static (no `[id]` segments that need real IDs at build time),
>    so the whole app is precacheable.
> 4. Exclude WebLLM model and wasm URLs from service worker caching, and let
>    WebLLM's own cache own them.
> 5. Call `navigator.storage.persist()` after the user first saves data, and
>    show the result where the playground banner talks about data loss.
> 6. Tell iOS users that the Safari tab and the Home Screen app keep separate
>    data, and that export/import moves it.
> 7. Skip push notifications, `beforeinstallprompt` UI and static export.
>    `experimental.useOffline` is optional and only worth it for an offline
>    indicator.

## Open questions for the decision ticket

- **Routing.** Should glossary and entry routes be static, with the ID in a
  query or in client state, so that offline reloads work? Or should the worker
  map dynamic paths to one shell?
- **When to register the worker.** On the first visit, or only after the user
  opts in or installs? Is the extra first-visit download acceptable on mobile?
- **iOS onboarding.** Should the app nudge iOS users to install _before_ they
  enter data, to avoid the empty-app surprise? Should it offer an export
  straight away?
- **`persist()` timing and messaging.** When should the app ask, and what
  should the banner say when it is denied?
- **Update UX.** A silent update or a reload prompt? How does that interact
  with an in-progress training session?
- **WebLLM.** Which `cacheBackend` should it use? Should the app expose
  "delete downloaded model" to free space? Should weights be served from the
  Vercel deployment instead? That would raise Hobby transfer and file-size
  questions this research did not cover.
- **Verify on a preview deployment:**
  - Vercel serves `/serwist/sw.js` with `Service-Worker-Allowed: /` (the
    header is set by a `force-static` route handler).
  - The precache size is reasonable.
  - Offline cold start works on iOS Safari and Android Chrome.

## Sources

1. Next.js 16.4.6 docs, "How to build a Progressive Web Application (PWA) with
   Next.js": `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`
2. Next.js 16.4.6 docs, `manifest.json` file convention:
   `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/manifest.md`
3. Next.js 16.4.6 docs, "Handling connectivity drops" (offline support):
   `node_modules/next/dist/docs/01-app/02-guides/offline-support.md`
4. Next.js 16.4.6 docs, `experimental.useOffline`:
   `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/useOffline.md`
5. Serwist docs, "Next.js + Turbopack" and "Getting started":
   https://serwist.pages.dev/docs/next/turbo,
   https://serwist.pages.dev/docs/next/getting-started. Also the
   `@serwist/turbopack@9.6.0` package source (`dist/index.mjs`,
   `dist/index.worker.mjs`, `dist/index.react.mjs`, `dist/chunks/index.schema-*.js`).
6. MDN, "Storage quotas and eviction criteria":
   https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
7. WebKit blog, "Updates to Storage Policy" (Safari 17):
   https://webkit.org/blog/14403/updates-to-storage-policy/
8. web.dev, "Persistent storage": https://web.dev/articles/persistent-storage
9. web.dev, "What does it take to be installable?":
   https://web.dev/articles/install-criteria
10. web.dev, Learn PWA, "Installation": https://web.dev/learn/pwa/installation
11. WebKit Bugzilla 181849, "'Add to homescreen' apps don't share storage with
    Safari": https://bugs.webkit.org/show_bug.cgi?id=181849
12. WebKit blog, "Full Third-Party Cookie Blocking and More" (7-day cap and Home
    Screen web apps): https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
13. Next.js 16.4.6 docs, static exports, "Unsupported Features":
    `node_modules/next/dist/docs/01-app/02-guides/static-exports.md`
14. Next.js 16.4.6 docs, Turbopack (default bundler since v16.0.0):
    `node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md`
15. MDN, `ServiceWorkerContainer.register()`:
    https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register
16. Vercel docs, "System environment variables":
    https://vercel.com/docs/environment-variables/system-environment-variables
17. WebLLM docs (via Context7, `/mlc-ai/web-llm`): "Advanced usage, Using
    IndexedDB cache" and `examples/cache-usage/README.md`:
    https://github.com/mlc-ai/web-llm/blob/main/docs/user/advanced_usage.rst
18. WebKit blog, "WebKit Features in Safari 26.0" ("Every site can be a web app
    on iOS and iPadOS"): https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
