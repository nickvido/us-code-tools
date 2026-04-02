# Roadmap

## Current Status

### ✅ Working
- **Transform pipeline** — USLM XML → chapter-level Markdown with full section hierarchy, cross-references, statutory notes
- **OLRC data acquisition** — download, cache, and extract XML for all 53 titles + historical vintages
- **Constitution backfill** — 28 backdated commits for constitutional amendments
- **OLRC backfill** — historical snapshots as backdated commits with proper author dates
- **Milestones** — annual and Congress-level git tags + GitHub Releases
- **Data source clients** — Congress.gov, GovInfo, VoteView, @unitedstates project (typed clients with rate limiting and caching)

### 🔧 Needs Work
- **Section body rendering** — some complex nested structures (deeply nested subsections, tables) may not render perfectly
- **Appendix titles** — 5A, 11a, 18a, 28a, 50A not yet supported (CLI only accepts integer title numbers)

## Planned

### Content Build for Web
- Offline script to transform chapter Markdown → JSON for CDN hosting
- Parse cross-references from section text into structured citation data
- Build inbound/outbound reference graph
- Upload to Cloudflare R2
- Separate from CI — manual process triggered when content updates

### Sync Engine
- Watch for new OLRC release points
- Automatically fetch, transform, and commit new data
- Optionally trigger content rebuild for web

### Bill Ingestion
- Fetch bills from Congress.gov API
- Create branches per bill (`bills/hr-NNN`, `bills/s-NNN`)
- Track bill lifecycle through committee, floor votes, signature
- Create PRs against the us-code repo

### Vote Attachment
- Parse VoteView roll call data
- Attach vote records to bill PRs
- Party breakdown, individual member votes

### Improved Diff Generation
- Per-section diffs between historical snapshots
- Structured diff output (not just git diff)
- Link changes to the public law that caused them

## Contributing

Issues and PRs welcome. See the [us-code](https://github.com/nickvido/us-code) repo for the content repository.
