# Coding standards

The automated reviewer reads this file on every pull request, and so should
anyone writing code here, person or agent. It starts small on purpose.

**How it grows:** when human review catches something these rules missed, add
a rule here (or, better, a check that makes the mistake impossible) and name
the bug that prompted it. A rule with no story behind it is a guess. The rules
below are seed rules from setting the project up; replace their _Why_ with a
real bug when one comes along.

## A check is never weakened to make it pass

Fix the code, not the check. No `eslint-disable`, `@ts-ignore`, `--no-verify`
or loosened config to get to green. Where an exception is truly needed, use a
line-scoped `@ts-expect-error` or `eslint-disable-next-line` with a comment
saying why, and expect review to push back. Changes to `.github/`, `.husky/`,
`tsconfig.json`, `eslint.config.mjs` or `.prettierrc.json` belong in their own
pull request, never inside a feature.

_Why:_ an agent's definition of done is "the checks pass". A check it can
switch off defines nothing.

## Behaviour ships with a test that fails without it

Every change to behaviour adds or updates a test, and the test must fail if the
change is reverted. Test through what a user sees (roles, labels, text), not
implementation details. Async Server Components can't render in Vitest; put
their logic in plain functions and test those.

_Why:_ a test that passes either way is coverage without a brake.

## Server Components by default; `"use client"` at the leaf

Pages and layouts stay Server Components. Add `"use client"` only to the small
component that needs state, effects, event handlers or browser APIs, never to a
page or layout to make an error go away.

_Why:_ the Next.js docs: mark only the interactive files, to keep client
bundles small (`node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`).

## Handle the missing case instead of asserting it away

`noUncheckedIndexedAccess` makes `items[0]` possibly `undefined`. Handle it
(early return, default, `notFound()`), and don't silence it with `!`.

_Why:_ the `!` turns a compile-time warning back into a runtime crash.

## Use the design system, not raw styles

Build UI from `@/components/ui` (shadcn/ui) and theme tokens such as
`bg-background`, `text-foreground` and `text-muted-foreground`. Don't hard-code
colours like `bg-white` or `text-zinc-500`. Add missing components with
`pnpm dlx shadcn@latest add <name>` rather than hand-writing them.

_Why:_ raw colours break dark mode and drift from the theme one PR at a time.

## Untrusted input is parsed at the edge

Search params, form data, route handler bodies and server action arguments are
validated with a schema before use. After that boundary, the value has a type
and is not re-checked.

_Why:_ the Next.js docs: Server Functions "are reachable via direct POST
requests, not just through your application's UI"
(`node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`).
