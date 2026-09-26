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

This is a single-page React + TypeScript app (Vite) that processes poker club Excel files. There is no backend — all logic runs in the browser.

**Core data flow:**
1. User uploads a "context file" (an Excel workbook that must contain a sheet named `Club Member Balance`).
2. User enters player nicknames — optionally with a line amount using `nickname/line` format (line values are entered in thousands, stored as raw numbers internally).
3. `filterWorkbookByNicknames` in `excelUtils.ts` processes the workbook: skips first 3 rows, reads columns K (nickname) and L (chips), matches rows by prefix against entered nicknames, computes Profit/Loss, splits into positive/negative tables, and appends a transfer table scaffold.
4. `downloadExcelFile` re-renders the filtered data using ExcelJS with borders and header styling before triggering a browser download.

**Two Excel libraries are used for different purposes:**
- `xlsx` (SheetJS): parsing — fast, used for reading and in-memory manipulation
- `exceljs`: writing only — used in `downloadExcelFile` to apply cell borders, bold headers, and column auto-width before generating the download blob

**Key files:**
- `src/utils/excelUtils.ts` — all Excel parsing, filtering, and download logic
- `src/components/NicknameInput.tsx` — textarea parser; `nickname/line` format, comma or dot as decimal separator
- `src/types/index.ts` — `NicknameWithLine` interface (nickname string + optional line number in raw chips)
