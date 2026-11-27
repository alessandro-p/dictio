# Browser storage for dictio's data

Research for [#20](https://github.com/alessandro-p/dictio/issues/20), under the
[dictio v1 spec](https://github.com/alessandro-p/dictio/issues/19) map. It
records facts with sources. The recommendation at the end is only a
recommendation: the decision belongs to a later ticket.

Researched November 2026.

## Question

Which browser storage should dictio use for its data: IndexedDB (directly, or
through a wrapper such as Dexie or idb) or localStorage? Covers quotas and
eviction on desktop and mobile, Safari's 7-day eviction, what
`navigator.storage.persist()` gets you, versioning and migration, and testing
in this repo's Vitest setup.

## localStorage vs IndexedDB

|          | localStorage                                          | IndexedDB                                                                   |
| -------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| API      | Synchronous; blocks the main thread [1][2]            | Asynchronous; does not block the main thread [2]                            |
| Values   | UTF-16 strings only; anything else is stringified [3] | Structured-clone values (objects, `Date`, `Set`, `Map`, `Blob`, ...) [4][E] |
| Size     | 5 MiB per origin (10 MiB with sessionStorage) [5]     | Shares the origin quota, a large share of disk (see below) [5]              |
| Queries  | Key lookup only                                       | Object stores, indexes, key ranges, transactions [4]                        |
| Workers  | Not available in web or service workers [2]           | Available in workers [2]                                                    |
| Eviction | Same per-origin rules as IndexedDB [5][6]             | Same [5][6]                                                                 |

- web.dev: "LocalStorage should be avoided because it is synchronous and will
  block the main thread. It is limited to about 5MB and can contain only
  strings." Its advice for app data is "use IndexedDB (with a promises
  wrapper)" [2].
- Over quota, writes fail with `QuotaExceededError` for both [5]. Reading
  `localStorage` can also throw `SecurityError` when the user blocks site
  data [3].
- Private browsing keeps the APIs but deletes the data when the session
  ends [1][5].

## Quotas

Best-effort is the default mode. Persistent mode is covered in the next
section.

| Browser                                                            | Per-origin quota                                                                                                    | Browser-wide cap |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Chrome / Edge (Chromium)                                           | Up to 60% of total disk, best-effort or persistent [5]                                                              | 80% of disk [5]  |
| Firefox                                                            | Best-effort: the smaller of 10% of disk or 10 GiB (group limit). Persistent: up to 50% of disk, capped at 8 TiB [5] | —                |
| Safari 17+ (macOS 14, iOS/iPadOS 17), browser app                  | Up to 60% of total disk [5][7]                                                                                      | 80% of disk [7]  |
| Safari 17+, Home Screen / Dock web app                             | Same as the browser app [7]                                                                                         | Same [7]         |
| Other apps embedding WebKit (e.g. in-app browsers using WKWebView) | Up to 15% of disk [5][7]                                                                                            | 20% of disk [7]  |
| Safari before 17                                                   | 1 GiB, then the user is asked [5]                                                                                   | —                |

Safari 17 no longer prompts when a site wants more space [7].
`navigator.storage.estimate()` returns estimates, not exact figures [5]. For a
text-only vocabulary notebook, quota is not a practical constraint.

## Eviction

- **Storage pressure / over the browser cap:** browsers evict best-effort
  origins in least-recently-used order, a whole origin at a time [5][7]. In
  WebKit, an origin that has an open page or is in persistent mode is
  excluded [7].
- **All or nothing:** an evicted origin loses all its data together, not part
  of it [5][7].
- Chrome's research found automatic clearing is rare; most clearing is done by
  users [5][6].

### Safari's 7-day cap on script-writable storage

- With tracking prevention on (the default), Safari deletes all
  script-writable storage of an origin after **7 days of Safari use** with no
  user interaction on that site. Interaction means a click, tap or keyboard
  entry; scrolling does not count [8][9][5].
- It covers IndexedDB, localStorage, sessionStorage, media keys, service worker
  registrations and caches, and cookies set by script. Cookies set by a server
  are exempt [8][5].
- WebKit documents it for all websites, not only domains classified as
  trackers (those get a separate 30-day rule) [9].
- The counter is days of Safari _use_, not calendar days [8]. A visitor who
  opens dictio and taps something at least once in every 7 days of using
  Safari keeps the data.
- **It applies to a site that is not installed.** Home Screen web apps "are
  not part of Safari and thus have their own counter of days of use", which
  matches actual use of the app, so WebKit does "not expect the first-party in
  such a web application to have its website data deleted" [8]. WebKit's
  tracking-prevention page lists Home Screen web apps as exempt [9], and
  web.dev says the policy "does not apply to installed PWAs that have been
  added to the home screen" [2].
- A Home Screen web app on iOS gets its own storage container: nothing is
  shared with Safari [2]. Data saved in the Safari tab does not carry over
  when the site is added to the Home Screen.
- No WebKit source says that `persist()` exempts a site from the 7-day cap.
  A WebKit bug asking to exempt sites that make no cross-origin requests
  (which would cover dictio) is still open, with no decision [10].

## `navigator.storage.persist()`

- It asks to move the origin from best-effort to persistent mode. Persistent
  data is evicted only when the user deletes it through browser settings
  [5][6]. It covers IndexedDB, Cache API, localStorage, OPFS, service workers
  and cookies [6]. `navigator.storage.persisted()` reports the current
  state [6][7].
- **Chromium:** no prompt. It is granted or silently denied from heuristics
  such as site engagement, being installed or bookmarked, and having
  notification permission. A denied request can be retried [6][5].
- **Firefox:** the user sees a permission prompt [5][6].
- **Safari:** no prompt. WebKit grants it "based on heuristics like whether
  the website is opened as a Home Screen Web App" [7].
- In Firefox, persistence also lifts the best-effort quota (10% of disk or
  10 GiB, up to 50% of disk) [5].
- web.dev advises requesting it when the user saves important data, ideally
  inside a user gesture, and not on page load [6].
- Persistence protects against **storage-pressure eviction**. It does not stop
  the user clearing site data, and no source says it stops Safari's 7-day
  cap (see above).

## Versioning and migration

### Raw IndexedDB

- `indexedDB.open(name, version)` takes an integer version; non-integers are
  rounded [4].
- Opening with a higher version than the stored one fires `upgradeneeded`.
  That handler, inside a `versionchange` transaction, is the only place to
  create or delete object stores and indexes [4].
- Changing an existing store's `keyPath` means deleting and re-creating the
  store, which deletes its data unless it is copied out first [4].
- Opening with a lower version than the stored one fails with `VersionError`,
  which must be handled [4].
- If another tab holds an older connection, the upgrade is `blocked` until
  that tab closes its connection; each connection should handle
  `versionchange` by calling `db.close()` [4].

### idb (Jake Archibald)

- Small (about 1.2 kB brotli) promise wrapper that mirrors the IndexedDB API
  [11]. web.dev links to it as the promises wrapper [2].
- `openDB(name, version, { upgrade, blocked, blocking, terminated })`.
  `upgrade(db, oldVersion, newVersion, transaction)` maps to `upgradeneeded`;
  the usual pattern is a chain of `if (oldVersion < n)` steps. `blocking`
  maps to `versionchange`, the hook for closing an old tab's connection [11].
- Typed schemas via the `DBSchema` generic [11].

### Dexie

- Declarative schema: `db.version(n).stores({ table: "primaryKey, index1,
*multiEntryIndex" })`. Data migrations go in `.upgrade(tx => ...)` and run
  only for databases below that version [12].
- Since Dexie 3, old version declarations only need to be kept when they have
  an upgrade function; otherwise you edit the schema and raise the version
  number [12].
- Tables are only dropped when a new version declares them `null`; indexes
  left out of a new declaration are dropped [12].
- The native IndexedDB version is the Dexie version times 10 [12].
- `useLiveQuery()` from `dexie-react-hooks` re-renders a React component when
  data its query reads changes, including changes from other tabs, as long as
  they were made through Dexie [13].

### Independent of the storage choice

Export/import is in the Core spec, so exported files carry their own format
version. An old export can then be upgraded on import by the same step chain
that upgrades the database.

## Testing in this repo's Vitest setup

The repo runs Vitest 5.1.1 with `environment: "jsdom"` (jsdom 29.1.1) and
`vitest.setup.ts` as the setup file, on Node 24 (`.nvmrc`).

- **jsdom has no IndexedDB.** A probe test in this setup logged
  `typeof indexedDB === "undefined"` and `typeof localStorage === "object"`
  [E]. localStorage works in tests as it is; IndexedDB needs a fake.
- **fake-indexeddb** is an in-memory, pure-JavaScript IndexedDB for Node
  [14]. `import "fake-indexeddb/auto"` installs `indexedDB`, `IDBKeyRange` and
  the other globals. A fresh, empty database per test comes from assigning
  `indexedDB = new IDBFactory()` (imported from `fake-indexeddb`) [14].
- fake-indexeddb needs `structuredClone`. Its README describes a jsdom
  workaround (a core-js polyfill or injecting Node's implementation) [14],
  written for Jest. **This repo does not need it:** Vitest's jsdom
  environment copies jsdom's window onto Node's global, so Node's
  `structuredClone` stays available, and the vm-based pool injects it
  explicitly [15][E].
- **Experiment [E]:** in a throwaway copy of this repo's config, with
  `fake-indexeddb` 6.2.8, `idb` 8.0.4 and `dexie` 4.4.7 (the newest versions
  allowed by the repo's `minimumReleaseAge` cooldown), adding
  `import "fake-indexeddb/auto"` to the top of `vitest.setup.ts` was enough
  for these tests to pass:
  - an idb `v1 → v2` migration that adds an index and rewrites every record
    in `upgrade`, with `Date` and `Set` values surviving the round trip;
  - a Dexie `version(1) → version(2).upgrade(...)` migration;
  - a fresh `IDBFactory` per test in `beforeEach`.
- Migrations can be tested the same way: open at version N, write data in
  the old shape, close, reopen at N+1, assert the new shape.
- fake-indexeddb does not model quotas, eviction, `persist()` or Safari's
  policies; those need manual checks in real browsers.

## Recommendation (not a decision)

> **Recommended:** IndexedDB, through a wrapper, with localStorage only for
> small UI preferences if any are needed.
>
> - **Dexie** if the data layer should also drive React re-renders and
>   cross-tab updates (`useLiveQuery`), and if a declarative
>   schema/index/upgrade model is preferred.
> - **idb** if the aim is the smallest dependency, staying close to the
>   native API, with dictio's own repository module on top.
>
> Both work with fake-indexeddb in the current Vitest setup with a single
> setup-file import and no polyfill.
>
> Call `navigator.storage.persist()` after a meaningful save (for example the
> first entry), not on load, and show the result honestly. Treat **export**
> as the real backup, given the playground banner and Safari's 7-day cap on
> non-installed sites. The cap is a reason to keep PWA install in view for
> the Later spec: a Home Screen web app is exempt.

## Open questions for later decision tickets

- **Dexie vs idb.** The trade-off is React integration and declarative
  migrations against bundle size and staying close to the platform. Dexie's
  bundle size was not measured here.
- **Safari 7-day cap UX.** Should the banner or onboarding warn Safari users
  that the data goes after 7 days of Safari use without visiting, and nudge
  them to export or add to the Home Screen? Adding to the Home Screen starts a
  separate, empty storage container on iOS [2], so data has to move across by
  export/import.
- **When to call `persist()`**, and whether to show "storage is persistent /
  best-effort" in the UI.
- **Multiple tabs.** Upgrades are blocked by an open older tab [4]; decide what
  the stale tab shows (`versionchange` → close and ask to reload).
- **Export format versioning**, and whether import replaces or merges data.
- **SSR boundary.** IndexedDB does not exist during Next.js server rendering,
  so the storage layer must only run in client components or effects. The
  pattern is for the implementation ticket.
- **Search.** Does cross-glossary search over every field use IndexedDB
  indexes (for example a multi-entry index of words) or an in-memory scan?
  That depends on the open Scale question on the map.

## Sources

1. MDN, [Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)
2. web.dev, [Storage for the web](https://web.dev/articles/storage-for-the-web)
3. MDN, [Window: localStorage property](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
4. MDN, [Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)
5. MDN, [Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
6. web.dev, [Persistent storage](https://web.dev/articles/persistent-storage)
7. WebKit blog, [Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/) (Safari 17)
8. WebKit blog, [Full Third-Party Cookie Blocking and More](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/) (7-day cap, Safari 13.1)
9. WebKit, [Tracking Prevention in WebKit](https://webkit.org/tracking-prevention/)
10. WebKit Bugzilla, [Bug 272189: ITP 7-day exception for origins that don't communicate with other origins](https://bugs.webkit.org/show_bug.cgi?id=272189)
11. idb, [README and API reference](https://github.com/jakearchibald/idb)
12. Dexie docs, [Database versioning](https://dexie.org/docs/Tutorial/Design#database-versioning), [Dexie.version()](<https://dexie.org/docs/Dexie/Dexie.version()>), [Understanding the basics](https://dexie.org/docs/Tutorial/Understanding-the-basics)
13. Dexie docs, [useLiveQuery()](<https://dexie.org/docs/dexie-react-hooks/useLiveQuery()>)
14. fake-indexeddb, [README](https://github.com/dumbmatter/fakeindexeddb)
15. Vitest 5.1.1 source, `vitest/dist` jsdom environment (`populateGlobal` and the vm-pool global list including `structuredClone`)

[E] Experiment run for this note: a throwaway copy of this repo's
`package.json`, lockfile, `vitest.config.mts` and `vitest.setup.ts`, with the
three libraries added. Nothing in the repo was changed.
