# us-code-tools

Ingestion engine, sync tooling, and applications for [v1d0b0t/us-code](https://github.com/v1d0b0t/us-code).

## What This Does

- Converts USLM XML (official US Code format) → markdown section files
- Syncs bills, votes, and member data from Congress.gov and GovInfo APIs
- Creates backdated commits and PRs in the `us-code` repo to represent legislative history
- Tracks bill lifecycle (introduction → committee → floor → signature/death)
- Attaches roll call vote records with party breakdowns

## Architecture

```
src/
├── sync/               # Orchestrator + scheduling
├── sources/            # API clients (Congress.gov, GovInfo, OLRC, VoteView)
├── transforms/         # USLM XML → markdown, vote formatting
├── git/                # Commit, branch, PR management
└── utils/              # Rate limiting, caching, logging
```

## Data Flow

```
OLRC (XML) ─────┐
GovInfo (JSON) ──┤
Congress.gov ────┼──→ us-code-tools ──→ git commits/PRs ──→ us-code repo
VoteView (CSV) ──┤
@unitedstates ───┘
```

## Setup

```bash
npm install
cp .env.example .env   # Add your api.data.gov key
```

## Usage

```bash
# Backfill historical data
npx us-code-tools backfill --phase=constitution
npx us-code-tools backfill --phase=baseline
npx us-code-tools backfill --phase=laws --congress=116

# Daily sync
npx us-code-tools sync

# Sync specific source
npx us-code-tools sync --source=bills
npx us-code-tools sync --source=votes

# Check status
npx us-code-tools status
```

## Specification

See [SPEC.md](./SPEC.md) for the full specification.

## License

MIT
