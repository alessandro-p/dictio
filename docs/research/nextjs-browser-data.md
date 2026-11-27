# Browser-only data in this Next.js version

Research for [#21](https://github.com/alessandro-p/dictio/issues/21). The
question is how to build an app whose data lives only in the browser with the
Next.js in this repo, while keeping CODING_STANDARDS.md's "Server Components by
default; `"use client"` at the leaf".

**Versions:** `next` 16.4.6, `react` / `react-dom` 19.3.0 (`package.json`).
`next.config.ts` sets `cacheComponents: true` and `partialPrefetching: true`.

**Sources:** the version-matched docs in `node_modules/next/dist/docs/`, cited
below as `docs/...` paths relative to that folder. I also read Next.js source
in `node_modules/next/dist/`, the `react-dom` 19.3.0 types and build, and
vercel.com/docs. I ran throwaway `next build`s against this repo's config to
check the claims about build output. Their results are marked **(verified by
build)**. None of that code was kept.

## 1. Where browser-only data reads belong

- Browser APIs such as `localStorage` and `window` are on the list of things
  that need a Client Component
  (`docs/01-app/01-getting-started/05-server-and-client-components.md`, "When
  to use Server and Client Components").
- Client Components are still **prerendered to HTML** at build time, so code
  that touches browser APIs must only run in the browser
  (`docs/01-app/02-guides/static-exports.md`, "Browser APIs";
  `docs/01-app/02-guides/single-page-applications.md`, "Rendering components
  only in the browser").
- The docs describe three ways to keep a component out of the prerender
  (`single-page-applications.md`, "Rendering components only in the browser"):
  1. `next/dynamic` with `ssr: false`.
  2. `useEffect`, with a `null` or loading state in the prerendered HTML.
  3. **New in React 19.3:** `use(browser())` from `react-dom`. During
     prerendering it suspends to the nearest `<Suspense>`, so the fallback
     becomes the initial HTML. In the browser `browser()` returns `undefined`
     and the component renders normally, so a lazy
     `useState(() => localStorage.getItem(...))` is safe. The docs say to use
     it "only when a Client Component's first browser render cannot match
     server-rendered HTML", which is exactly the case for browser-only data.
     The type is `browser(reason?: string | (() => unknown)): BrowserUsable`,
     `@version 19.3.0`, in `node_modules/@types/react-dom/index.d.ts`.
- Under Cache Components, `use(browser())` is the documented way to keep a
  component that reads `sessionStorage` (or similar) out of the server render.
  Don't count on a `useSearchParams` Suspense boundary to do that job
  (`docs/01-app/03-api-reference/04-functions/use-search-params.md`,
  "Prerendering").
- This fits the coding standard. The page and layout stay Server Components
  and render the static frame (headings, banner, nav, a `<Suspense>` with a
  skeleton fallback). A small `"use client"` leaf inside the Suspense boundary
  reads storage. **(verified by build)** A page built this way prerenders as
  `○ Static`, and its HTML contains the Suspense fallback.

## 2. Hydration mismatches and loading flashes

- The docs list the trade-offs
  (`docs/01-app/02-guides/preventing-flash-before-hydration.md`, intro):
  - Re-rendering with client values during hydration causes a **hydration
    error**.
  - Deferring to `useEffect` avoids the error but causes a **visible flash**.
  - `useLayoutEffect` prevents only the flash between hydration and paint, not
    the one before React loads (same doc, "Why not `useEffect`?").
- `use(browser())` avoids the mismatch completely: the server never renders
  the data, so there is nothing to mismatch. The price is that on a hard load
  (first visit or refresh) the user sees the Suspense fallback until JS
  hydrates. A layout-matched skeleton keeps that from looking like a jump. On
  a client-side `<Link>` navigation nothing is prerendered, so a synchronous
  store such as `localStorage` renders straight away with no fallback (my
  reading of `single-page-applications.md`: "In the browser, `browser()`
  returns `undefined`"). An async store such as IndexedDB still suspends
  briefly.
- For **small UI preferences that change the first paint** (theme, an
  open/closed panel), the docs recommend an **inline `<script>`**. It reads
  `localStorage` while the HTML is parsed, before the first paint, and is
  paired with `suppressHydrationWarning` and a lazy `useState` initializer
  that reads the same key
  (`preventing-flash-before-hydration.md`, "Themes" and "Syncing with React
  state"). In development, Strict Mode clears attributes the script set on
  `<html>`. The docs re-apply them in `useLayoutEffect` (same doc,
  "Re-applying attributes in development").
- Don't store preferences in cookies to dodge the flash. Reading `cookies()`
  in the root layout opts the whole app out of static prerendering, and under
  Cache Components it blocks every segment below (same doc, "Storing the theme
  in a cookie"). Cookies also clash with the "no cookies" constraint in #19.
- **Cache Components keeps routes alive:** on client navigation the previous
  route is set to `<Activity mode="hidden">` rather than unmounted. State is
  kept, effects are cleaned up while hidden and re-run when visible
  (`docs/01-app/03-api-reference/05-config/01-next-config-js/cacheComponents.md`,
  "Navigation with Activity"). A hidden page that holds data in `useState`
  can therefore come back showing stale data after an edit made elsewhere.
  Storage reads need to re-sync when the route is shown again, for example
  through a subscription or an effect.

## 3. Static export vs default output on Vercel Hobby

- **Static export cannot be combined with this repo's config.** With
  `output: 'export'` and `cacheComponents: true`, `next build` fails with
  `Invariant: PPR cannot be enabled in export mode`. The check is in
  `node_modules/next/dist/export/index.js`: "Export mode provide static
  outputs that are not compatible with PPR mode". **(verified by build)**
  Removing `cacheComponents` and `partialPrefetching` lets the export build
  and write `out/` **(verified by build)**. That would undo a setting the repo
  chose on purpose, and the docs say both features "will be enabled
  everywhere in the next major release" (`cacheComponents.md`, "Usage").
- Static export also turns off rewrites, redirects, headers, Proxy, ISR, the
  default image loader, Server Actions, and dynamic routes without
  `generateStaticParams` (`static-exports.md`, "Unsupported Features"). A
  browser-only app needs almost none of these. The real cost is dynamic
  routes (section 4) and `next.config` headers (a CSP, if one is wanted
  later).
- **Default output on Vercel:** routes that prerender as `○ Static` are
  served as static files. Vercel only counts function invocations for
  rendering on demand (SSR, and the dynamic holes of PPR): "the static shell
  is served with ISR, while Vercel Functions renders the dynamic holes"
  ([Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs),
  "Partial Prerendering" and "Server-Side Rendering").
- **Hobby allotments**
  ([Hobby plan](https://vercel.com/docs/plans/hobby)): 1,000,000 function
  invocations, 4 active CPU-hours, 100 GB Fast Data Transfer, 1,000,000 CDN
  requests per month. Going over pauses the feature until 30 days have
  passed. A static file isn't counted as a build, but every Vercel Function is
  ([Limits](https://vercel.com/docs/limits), "Builds per hour (Hobby)").
- Bottom line: on Vercel, an app whose routes all prerender as `○ Static`
  under the default output is served like a static site and keeps Cache
  Components. Static export pays off only for hosts that serve static files
  and nothing else (`docs/01-app/01-getting-started/17-deploying.md`, "Static
  export"). Offline use is the PWA question and needs a service worker either
  way (`docs/01-app/02-guides/offline-support.md`, the note under the first
  example).

## 4. Dynamic routes when the data isn't known at build time

- With Cache Components and no `generateStaticParams`, params are runtime
  data. Reading them must sit inside `<Suspense>`. Next.js builds a static
  shell, and the content renders **on each request**
  (`docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md`,
  "With Cache Components" > "Without `generateStaticParams`").
  **(verified by build)** `app/g/[id]/page.tsx` with a client leaf that reads
  `useParams()` and storage builds as `◐ Partial Prerender`. On Vercel that
  means a function invocation to resume the render for each pathname. With
  `generateStaticParams`, pages rendered with runtime params "are saved to
  disk after a successful first request" (same doc), which turns every
  glossary id a visitor opens into a server render and a cache entry. That is
  pointless work when the server never sees the data.
- With static export, a dynamic route has to list its params at build time.
  `dynamicParams: true` and routes without `generateStaticParams` are not
  supported (`static-exports.md`, "Unsupported Features"). **(verified by
  build)** Leaving out `generateStaticParams` fails with `Page "/g/[id]" is
missing "generateStaticParams()"`. Returning `[]` fails with `returned an
empty array ... With "output: export", at least one route must be
generated`. Ids created in the browser can't be listed at build time.
- **Option that works under both outputs:** keep the route static and put the
  id in the **query string**, for example `/glossary?id=…`. The page is a
  Server Component with a `<Suspense>` around a client leaf that reads
  `useSearchParams()` (`use-search-params.md`, "Prerendering") and storage,
  guarded by `use(browser())`. **(verified by build)** It builds as
  `○ Static` with the default output and also exports. Shallow updates can go
  through `window.history.pushState` and `replaceState`, which the router
  picks up (`single-page-applications.md`, "Shallow routing on the client").
- Other options:
  - A placeholder param (`generateStaticParams` returns one dummy id) plus a
    host rewrite from `/g/*` to that page. Vercel supports `vercel.json`
    rewrites, but its docs say to prefer the framework's own routing for
    rewrites within one app
    ([Rewrites](https://vercel.com/docs/rewrites), "Framework
    considerations"). Next.js rewrites are unavailable under export. This is
    fragile and I did not test it.
  - Accept `◐` dynamic routes under the default output, which costs function
    invocations against the Hobby allotment.
- Privacy note: the path and the query string both reach Vercel's CDN as part
  of the request URL. Only a `#fragment` stays in the browser. An opaque
  random id in the URL reveals nothing. A glossary name or term in the URL
  would leave the browser.

## Recommendation

> **This is a recommendation, not a decision.** The decision belongs to a later
> ticket.

- **Keep the default output and `cacheComponents`.** Don't switch to
  `output: 'export'`: it can't coexist with Cache Components in 16.4.6, and on
  Vercel the default output already serves fully static routes as static
  files.
- **Aim for every route to build as `○ Static`.** Treat a `◐` or `ƒ` in the
  build's route table as a regression. It is cheap to check in CI or review.
- **Address a glossary by query string** (`/glossary?id=<opaque id>`), not by
  a `[id]` path segment, so no request ever needs a server render.
- **Pattern:** Server Component page and layout → `<Suspense>` with a
  layout-matched skeleton → a small `"use client"` leaf that calls
  `use(browser(...))` and then reads storage. Use an inline `<script>` only
  for first-paint preferences such as theme.
- Re-sync storage reads when a route is shown again, because Activity keeps
  hidden routes mounted.

## Questions for later tickets

- **Storage engine:** with `localStorage` (synchronous), soft navigations
  render with no fallback. IndexedDB (asynchronous) is roomier but always
  suspends briefly. Which one, given the scale question in #19 and the AI and
  offline plans?
- **Sync between tabs and between routes:** a subscription such as
  `useSyncExternalStore` plus the `storage` event, so two tabs and
  Activity-hidden routes stay current.
- **URL shape:** are glossary URLs meant to be stable and bookmarkable, given
  that ids exist in only one browser? And how is an unknown or deleted id
  handled on a static page, when `notFound()` can't run on the server for
  browser data?
- **CSP:** inline scripts need `'unsafe-inline'` or a nonce
  (`preventing-flash-before-hydration.md`, "Good to know" under "Extracting a
  reusable component"). Nonces need dynamic rendering, which would undo
  "all routes `○ Static`"
  (`docs/01-app/02-guides/content-security-policy.md`). Another option is a
  hash-based CSP. Does the spec want a CSP?
- **PWA / offline:** a full reload while offline needs a service worker
  (`offline-support.md`). The experimental `useOffline` flag only covers soft
  navigations into prefetched routes. Which service-worker approach works
  with the default output on Vercel?
