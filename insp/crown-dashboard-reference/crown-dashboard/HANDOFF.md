# Crown Pokerklubb dashboard: integration handoff

This folder is a **reference implementation** of a club-owner dashboard for ClubGG weekly
exports. It was prototyped on claude.ai. Your job (Claude Code) is to rebuild it as
native React + TypeScript inside the user's existing **Vite** project. Treat this folder
as a spec, not code to paste in verbatim.

All player names, IDs and numbers are **made-up sample data** generated from the shape
of a real export. It is safe to commit.

## What's in here

| Path | What it is |
|---|---|
| `index.html` | The working reference page. Open it in a browser (it loads d3 from jsDelivr). Every tab, chart and interaction you need to reproduce is here. |
| `js/dash-shim.js` | A small stand-in for the claude.ai dashboard runtime (`dash.data`, `dash.calc`, `dash.onData`, `dash.params`). It shows the data flow; don't port it. |
| `data/*.json` | The five datasets (sample). `data/data.js` holds the same data as `window.CK_DATA` for the reference page. |
| `ts/types.ts` | TypeScript row types for the five datasets. **Copy this into the project.** |
| `ts/metrics.ts` | Pure functions for every derived number (totals, agent downlines, player stats, heatmap and so on), ported 1:1 from the `dash.calc` blocks in `index.html`. Type-checked with `--strict` and verified against the reference output. **Copy this into the project.** |
| `tools/clubgg_to_json.py` | Converts a ClubGG `.xlsx` export into the JSON datasets (Python + openpyxl). The sheet and column mapping is documented inline. |
| `sample/182383_20261019084503_demo.xlsx` | A sample export in exactly ClubGG's format, with fake data. Use it to test parsing. |
| `screenshots/*.png` | The reference page rendered at 1280 px, one image per tab. |

## The page, tab by tab

A header with the club name, the week, a one-sentence takeaway, and a clock toggle:
**Oslo time** (export time + 9 h, the default) or **Export time (UTC−7)**. The toggle
affects the heatmap, the timeline and every shown timestamp.

1. **Overview**: six KPI tiles (rake & fees, ring sessions, table hours, rake per table
   hour, hands, active players) · stacked bars of ring rake per day split by NLH/PLO5 ·
   a heatmap of average open tables per weekday-night × hour · a sortable "results by
   stake" table with an in-cell bar.
2. **Tables**: a Gantt-style timeline with one bar per ring session, one row per night
   (06:00 to 06:00), overlapping tables stacked into lanes, coloured by game · a sortable
   sessions table.
3. **Players**: top-15 rake contributors (horizontal bars) · biggest winners and losers
   (diverging bars) · a searchable, sortable table of all members with an "only members
   who played" toggle. Clicking a bar or a row opens that player's profile.
4. **Player profile**: a player picker · KPIs (net, rake paid, hands, sessions with the
   share that ended in profit, chip balance) · a running-result line chart across
   sessions · result by game (NLH / PLO5 / tournament) · a "how they play" grid
   (favourite stake, average/total buy-in, biggest win/loss, rake per 100 hands,
   tournament prize/net) · the session history table. The agent name links to that
   agent's page.
5. **Agents**: an agent picker (agents, super agents and "Direct") · downline KPIs
   (rake & fees generated, players' net, members/active, hands, chips held) · downline
   rake per day · a downline players table (rows open profiles) · an "all agents
   compared" table (rows select the agent).
6. **Tournament**: KPIs (entries, guarantee paid, overlay, re-entry fees) and the prize
   list.

### Domain rules to keep

- ClubGG counts **hands per seat**, so a table's "hands" is the sum over its players.
- Player P&L sums to `-(rake + bad beat jackpot contribution)` per session.
- A **night** runs 06:00 to 06:00, so 01:00 Oslo time counts as the evening before.
- **Downline membership** (`ownersOf` in `metrics.ts`): a member belongs to their
  agent, to their super agent, and an agent also belongs to their own downline.
  Members with none of these belong to "Direct".
- The Oslo offset is hard-coded as +9 h, which is right for this week (summer time ends
  25 Oct 2026). For other weeks, use a real time-zone library.

## Suggested integration in a Vite + React + TS project

1. **Look at the project first**: router, styling (Tailwind? CSS modules?), any existing
   chart library, state management, lint and format rules. Follow those conventions.
2. Add `src/features/clubgg/` (or the project's equivalent) with:
   - `types.ts` and `metrics.ts` from `ts/`
   - `data/` holding the five sample JSON files, imported statically
     (`import members from './data/members.json'` needs `resolveJsonModule`), or
     fetched from `public/`
   - `useClubData()`: a hook returning `ClubData`, so the source can later become an API
     or an in-browser upload
3. Build components per tab: `OverviewTab`, `TablesTab`, `PlayersTab`, `PlayerProfile`,
   `AgentsTab`, `TournamentTab`, plus shared `KpiTile`, `SortableTable` and `ChartCard`.
   Keep the selected player, agent, tab and clock zone in the URL (search params or
   routes like `/players/:id` and `/agents/:name`) so profiles can be linked to.
4. **Charts.** If the project already has a chart library, use it (Recharts handles
   bars, stacked bars and lines; the heatmap and Gantt timeline are easiest as plain SVG
   in React). Otherwise `d3-scale` and `d3-shape` with React-rendered SVG match the
   reference most closely. Keep tooltips inside the card.
5. **Optional: upload exports in the browser.** Port `tools/clubgg_to_json.py` to TS with
   SheetJS (`xlsx` package) so the user can drop a new weekly `.xlsx` in the app. The
   column indices and the block parsing for "Ring Game Detail" are all in that script.
   Test against `sample/182383_20261019084503_demo.xlsx`; the expected row counts are
   sessions 61, player_sessions 739, members 154, mtt 1, mtt_results 45.
6. **Verify**: headline numbers must match the reference. On the sample data that's
   rake & fees 215,312 · active players 88 · PLO5 share 68.5% · top-10 share 37.5% ·
   agent SharkGutt with 5 members, 7,293.48 in fees and −11,883.72 players' net ·
   player grinderdad (9667-1940) with 55 sessions and a biggest win of +4,620.93.
