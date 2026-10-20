# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start dev server (localhost:5173)
npm run build     # Type-check + build to dist/
npm run lint      # Run ESLint
npm run preview   # Preview the production build
```

## Architecture

This is a single-page React + TypeScript app (Vite) that processes poker club Excel files. All logic runs in the browser; statistics are stored in Supabase (project `bkk-maskin`, ref `ojrwrnqsucydveilfyzt`).

`src/App.tsx` switches between two tabs: **Machine** (`src/pages/MachinePage.tsx`, the Excel filter) and **Statistics** (`src/pages/StatsPage.tsx`). The stats page shows club totals and a daily rake chart, then a Players / Agents switch (`src/pages/stats/PlayersView.tsx`, `src/pages/stats/AgentsView.tsx`) and an upload log (`src/pages/stats/UploadLog.tsx`) where a stored upload can be clicked to show only its period, or deleted (`delete_period` database function).

**Core data flow:**
1. User uploads a "context file" (an Excel workbook that must contain a sheet named `Club Member Balance`).
2. Active players are pre-filled into a table where the user can set line (entered in thousands, stored as raw numbers internally), rakeback % and owner per player, and add or delete players.
3. `filterWorkbookByNicknames` in `excelUtils.ts` processes the workbook: locates columns by header name (Member → Nickname and Chips in `Club Member Balance`; Member → Nickname and Rake&Fee → Total in `Member Statistics`), reads rows until the `TOTAL` row, matches rows by prefix against entered nicknames, computes Profit/Loss, splits into positive/negative tables, and appends a transfer table scaffold.
4. If "Update data" is checked, the filter's `summary` is saved with `savePeriod` (`src/utils/statsApi.ts`) for the period read by `extractPeriod` ("Period : 2026-10-15 ~ 2026-10-15" at the top of `Member Statistics`). The `save_period` database function replaces a period that is already stored, so re-uploading never doubles the stats.
5. `downloadExcelFile` re-renders the filtered data using ExcelJS with borders and header styling before triggering a browser download.

**Two Excel libraries are used for different purposes:**
- `xlsx` (SheetJS): parsing — fast, used for reading and in-memory manipulation
- `exceljs`: writing only — used in `downloadExcelFile` to apply cell borders, bold headers, and column auto-width before generating the download blob

**Key files:**
- `src/utils/excelUtils.ts` — all Excel parsing, filtering, and download logic
- `src/components/NicknameInput.tsx` — editable player table (nickname, line in 1000s, rakeback %, owner checkbox, add/delete rows, nickname search with "Clear search"; agents in the agents list and their players are hidden from the table but still passed on, since they go in the agent tables); comma or dot as decimal separator
- `src/utils/statsApi.ts` — Supabase client and queries (`periods` and `player_stats` tables, `save_period` / `player_totals` / `agent_totals` functions). Stats are kept for one year: a `pg_cron` job (`delete-old-stats`, 03:00 UTC) runs `delete_old_stats()`, and `save_period` rejects older periods. A player's agent and `is_agent` come from `Member Statistics`; `agent_share` is only set for players placed in an entered agent table. `periods.bbj_contribution` / `bbj_payout` are the sums of "Bad Beat Jackpot" → "Contribution Fee" / "Payouts" over every member in `Member Statistics`. Needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
- `src/components/StatsCharts.tsx` — hand-written SVG column and line charts used by the stats page
- `src/types/index.ts` — `NicknameWithLine` interface (nickname string + optional line number in raw chips); `KNOWN_AGENTS`, the agents always shown in the agents list with a fixed rake % (an agent can have a different % for his own play and for single players)
