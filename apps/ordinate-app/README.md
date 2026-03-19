# ordinate-app

Read-only web prototype for Ordinate using React + Vite + AG Grid.

## Run

```bash
cd apps/ordinate-app
npm install
npm run dev
```

## Current behavior

- Default view is table mode (read-only).
- Source Code Mode: edit raw `.ord` text.
- Exit Source Code Mode: parse/evaluate via `packages/core-ts` and re-render table.
- Source round-trip: entering Source mode serializes from in-memory `DocumentState`.
- Hierarchy rows support basic collapse/expand toggle.
- Default sample includes multiple sheets: management report, text-heavy notes, error playground, and regional hierarchy.

## Notes

- AG Grid is only the view layer.
- Formula parsing/evaluation comes from `core-ts`.
- Grid editing/drag interaction is intentionally disabled in this phase.

## Third-party

- See `THIRD_PARTY_NOTICES.md` for font attribution and license notices.
