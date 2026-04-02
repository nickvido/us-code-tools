# us-code-tools

Ingestion engine and tooling for [nickvido/us-code](https://github.com/nickvido/us-code) — the United States Code as a Git repository.

## What This Does

- **Transform:** Converts USLM XML (official US Code format) → structured Markdown chapter files
- **Backfill:** Creates backdated commits in the us-code repo from historical OLRC release points
- **Fetch:** Downloads data from 5 federal sources (OLRC, Congress.gov, GovInfo, VoteView, @unitedstates)
- **Milestones:** Tags commits with annual and Congress-level markers, creates GitHub Releases

## Commands

```bash
# Transform OLRC XML → Markdown (single title or all)
npx us-code-tools transform --title 18 --output ./out --group-by chapter
npx us-code-tools transform --all --output ./out --group-by chapter

# Backfill historical snapshots into a target repo
npx us-code-tools backfill --phase constitution --target ~/us-code
npx us-code-tools backfill --phase olrc --target ~/us-code --vintages 2013,2015,2017
npx us-code-tools backfill --phase olrc --target ~/us-code --vintages 2013 --dry-run

# Fetch raw data from federal sources
npx us-code-tools fetch --status                    # Check what's cached
npx us-code-tools fetch --source olrc               # Download OLRC XML
npx us-code-tools fetch --source congress --congress 118
npx us-code-tools fetch --all                       # All sources
npx us-code-tools fetch --list-vintages             # List available OLRC release points
npx us-code-tools fetch --all-vintages              # Download all OLRC vintages

# Tag commits with annual/Congress milestones + GitHub Releases
npx us-code-tools milestones plan --target ~/us-code --metadata ./milestones.json
npx us-code-tools milestones apply --target ~/us-code --metadata ./milestones.json
npx us-code-tools milestones release --target ~/us-code --metadata ./milestones.json
```

## Architecture

```
src/
├── commands/           # CLI entry points (fetch, milestones)
├── backfill/           # Constitution + OLRC backfill orchestration
│   ├── constitution/   # Constitution commit generation
│   ├── olrc-*.ts       # OLRC vintage planning + orchestration
│   ├── git-adapter.ts  # Git operations for backfill commits
│   └── renderer.ts     # Markdown rendering for backfill
├── sources/            # Data acquisition clients
│   ├── olrc.ts         # OLRC XML download + extraction
│   ├── congress.ts     # Congress.gov API (bills, members)
│   ├── govinfo.ts      # GovInfo API (public laws, CFR)
│   ├── voteview.ts     # VoteView (roll call votes)
│   └── unitedstates.ts # @unitedstates project (legislators)
├── transforms/         # USLM XML → Markdown pipeline
│   ├── uslm-to-ir.ts   # XML → intermediate representation
│   ├── markdown.ts      # IR → Markdown rendering
│   └── write-output.ts  # File output (section or chapter grouping)
├── milestones/         # Tagging + GitHub Releases
├── domain/             # Shared types + normalization
├── types/              # TypeScript type definitions
└── utils/              # Rate limiting, caching, manifest tracking
```

## Data Flow

```
OLRC (USLM XML) ──→ fetch ──→ cache ──→ transform ──→ Markdown files
                                  │
                                  └──→ backfill ──→ git commits ──→ us-code repo
                                          │
                                          └──→ milestones ──→ tags + releases
```

## Setup

```bash
npm install
npm run build
```

For data acquisition from Congress.gov and GovInfo, you'll need an [api.data.gov API key](https://api.data.gov/signup/) (free).

## Tests

```bash
npm test               # Run all tests
npx vitest run         # Same thing
```

## Roadmap

See [ROADMAP.md](ROADMAP.md) for planned features.

## License

MIT

## Credits

Built by [nickvido](https://github.com/nickvido) and [v1d0b0t](https://github.com/v1d0b0t).
