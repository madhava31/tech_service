# Technicon Services ERP

Local PE Funnel data (7 Nov 2026) lives in SQLite only. Read [docs/local-pe-funnel-import.md](docs/local-pe-funnel-import.md) and the root [README.md](README.md). Do not point that load at Supabase.

## Frontend redesign rules
- `design/technicon-erp.html` is the visual reference only. Never copy its data or its in-memory logic.
- Do NOT change the backend: nothing in `app/server`, `api/`, `app/api`, database schema, environment variables or auth.
- Keep every call in `app/client/src/api.ts` exactly as it is. Pages restyle their markup only. `docs/backend-map.md` lists what each page calls.
- Copy the design's values exactly: colours, sizes, radius, shadows, timings. Do not reinterpret or "improve" it.
- Colours come from the tokens in `app/client/tailwind.config.js` (`bg-surface2`, `text-subtle`, `bg-ink`, `text-onink`, `border-line2`, `bg-good`/`bg-goodbg` …), never hard-coded hex, so light and dark mode both work.
- Work one page at a time. After each page run `npm --prefix app/client run build` and fix every error before moving on.
