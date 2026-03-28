# US Code Tools — Roadmap

*How we get from empty repos to "every law a commit, every bill a PR, every vote on record."*

---

## Phase 1 — Foundation ✅
> Build the core tooling to ingest and transform legal data.

- [x] **Issue #1:** USLM XML to Markdown Transformer — parse OLRC XML, output section-level markdown with YAML frontmatter
- [x] **Issue #3:** Constitution Backfill CLI — scaffold for backdated git commits (needs real data before running)

## Phase 2 — Current Law Snapshot
> Download all US Code data and populate `us-code` repo with real content.

- [ ] **Issue #4: Bulk US Code Ingestion** — download all ~54 titles from OLRC (uscode.house.gov) as USLM XML, transform to markdown via the existing transformer, and commit as a point-in-time snapshot to `us-code`. This includes the Constitution (articles + amendments). One commit per title, backdated to the OLRC release point date. Tags for the release point.
  - *This replaces the separate "Constitution data validation" step — real data comes from the authoritative source.*

## Phase 3 — Historical Depth
> Build the timeline backwards so users can browse law at any point in history.

- [ ] **Issue #5: Historical Release Point Backfill** — OLRC publishes annual/periodic release points going back several years. Walk backwards through release points, creating backdated commits for each. Diffs between release points show what changed year over year.
- [ ] **Issue #6: Public Law Mapping** — use GovInfo API to map each public law to the USC sections it changed. Connects "why did this section change?" to the specific legislation. Enriches commit messages and PR bodies.

## Phase 4 — Bills as PRs
> Make the legislative process visible through GitHub's PR workflow.

- [ ] **Issue #7: Congress.gov Bill Sync** — pull active bills from Congress.gov API, create branches (`bills/hr-{N}`, `bills/s-{N}`), open PRs with bill text and status tracking. PR body = living document updated as bill progresses.
- [ ] **Issue #8: Vote Records** — integrate VoteView + Congress.gov roll call data. Attach vote breakdowns (by party, by member) to PR bodies. Labels for pass/fail.
- [ ] **Issue #9: Member Data** — @unitedstates legislator dataset. Map commit authors to real bill sponsors. Committee members as context in PRs.

## Phase 5 — Living System
> Automate everything so the repo stays current without manual intervention.

- [ ] **Issue #10: Sync Engine** — daemon/cron that polls for new public laws, bill status updates, vote results, and new OLRC release points. Keeps `us-code` current automatically.
- [ ] **Issue #11: Failed Bills as Closed PRs** — bills that died in committee or failed floor votes → closed PRs with vote records and status labels. Historical record of what was proposed but didn't pass.
- [ ] **Issue #12: Git Tags for Milestones** — tag major legislation (Civil Rights Act, PATRIOT Act, ACA), Congress boundaries (start/end of each Congress), presidential terms. GitHub Releases as a browsable American legal history timeline.

## Phase 6 — Web Interface (`us-code-web`)
> Make it accessible to everyone, not just git users.

- [ ] Time travel slider — pick any date, browse law as it existed then
- [ ] Search — full-text search across all sections
- [ ] Diffs — side-by-side comparison between any two points in time
- [ ] Bill tracker — active legislation with status, votes, sponsors
- [ ] Git blame — who wrote each paragraph of law
- [ ] Cross-reference graph — which laws reference which
- [ ] AI assistant — "what does the law say about X?" grounded in actual statute text
- [ ] See `docs/BACKLOG.md` in `us-code-web` for full feature list

---

## Current Status

| Phase | Status | Notes |
|-------|--------|-------|
| 1 — Foundation | ✅ Complete | Transformer + backfill CLI built via DF2 pipeline |
| 2 — Current Law | 🔜 Next | Issue #4 = next ticket |
| 3 — Historical | Planned | Depends on Phase 2 |
| 4 — Bills as PRs | Planned | Depends on Phase 3 |
| 5 — Living System | Planned | Depends on Phase 4 |
| 6 — Web Interface | Planned | Can start in parallel after Phase 2 |

---

*Created: 2026-03-28*
*Last updated: 2026-03-28*
