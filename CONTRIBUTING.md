# Contributing

Memex is a solo project, but here's the process for anyone poking around.

## Setup

```bash
git clone https://github.com/ronmasuary/Memex.git
cd Memex
npm run setup   # root + web installs and both builds, in one command
```

`npm run setup` is the one-shot for the full tree. The pieces are also available on their own: `npm install` (root deps), `npm run build` (server + CLI → `dist/`), `npm run build:web` (UI → `web/dist/`), and `npm run build:all` (both). For a live UI with hot reload, use `npm --prefix web run dev`.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

All four run in CI on every PR, across Ubuntu, macOS and Windows.

## Branches and commits

- Branch names: `day-N-<short-topic>` or `fix/<short-topic>`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
  `feat: ...`, `fix: ...`, `chore: ...`, `docs: ...`, `test: ...`.
- `main` is protected: all changes land via PR with green CI, no direct pushes.

## Dependencies

- **`@types/node` tracks the oldest supported Node runtime, not the newest
  published major.** We target Node 20 (`engines`, and the CI matrix runs node 20
  and 22), so `@types/node` stays on `^20`. Bumping it to a higher major would make
  TypeScript accept APIs that don't exist on Node 20 at runtime — the types would
  describe a newer standard library than we actually run on. Only move it when the
  Node floor itself moves, and change `engines` and the CI matrix in the same PR.
  (Dependabot will periodically propose the newer major; close those as
  "not planned" with this reason.)

## Before a large PR

Open an issue first describing what you want to change, so effort isn't wasted
on something that doesn't fit the project's direction.
