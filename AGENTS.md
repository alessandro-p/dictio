<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Verification checks

Before you report a change as complete, run:

1. `pnpm check`: Prettier check, ESLint (zero warnings), typecheck, unit tests
2. `pnpm build`

Fix formatting with `pnpm format`. The pre-commit hook runs the fast checks on
every commit, and CI runs all of them on every pull request.

Never get to green by weakening a check: no `--no-verify`, no disabled rules or
loosened config. Leave `.github/`, `.husky/` and the check configs alone unless
the ticket is about them.

## Coding standards

Read [CODING_STANDARDS.md](./CODING_STANDARDS.md) before writing code. The
automated reviewer holds every pull request to it.
