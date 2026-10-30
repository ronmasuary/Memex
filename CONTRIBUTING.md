# Contributing

Memex is a solo project, but here's the process for anyone poking around.

## Setup

```bash
git clone https://github.com/ronmasuary/Memex.git
cd Memex
npm install
```

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

## Before a large PR

Open an issue first describing what you want to change, so effort isn't wasted
on something that doesn't fit the project's direction.
