# Data Acquisition Runbook

How to acquire, transform, and load all upstream data for the US Code as Git project.

---

## Overview

| Phase | Source | Auth | Rate Limit | Est. Time | Blocking? |
|-------|--------|------|------------|-----------|-----------|
| 1 | GovInfo Bulk Data (historical ZIP/XML) | None | None (bounded locally to 2 downloads) | Hours | No |
| 2 | OLRC (US Code XML) | None (cookies required) | None | ~20 min | No |
| 3 | VoteView (CSV) | None | None | ~10 min | No |
| 4 | Legislators (YAML) | None | None | ~10 sec | No |
| 5 | GovInfo API (Public Laws incremental) | `API_DATA_GOV_KEY` | 5,000 req/hr (shared) | Hours–days | Yes |
| 6 | Congress.gov (Bills/Members incremental) | `API_DATA_GOV_KEY` | 5,000 req/hr (shared) | Days–weeks | Yes |

Phases 1–4 can run immediately with no credentials. Phases 5–6 share a single API key and rate budget.

---

## Prerequisites

```bash
# Clone and build
git clone git@github.com:v1d0b0t/us-code-tools.git
cd us-code-tools && npm install && npm run build

# API key (only needed for phases 4–5)
export API_DATA_GOV_KEY="<from Bitwarden: 'api.data.gov'>"
```

Storage: `data/` is gitignored. All cached artifacts land in `data/cache/{source}/`. Status tracked in `data/manifest.json`.

---

## Phase 1: GovInfo Bulk Data Repository

**What:** Historical backfill path for GovInfo collections using anonymous bulk ZIP/XML downloads instead of API crawling.

**Source URL:** `https://www.govinfo.gov/bulkdata/`

**CLI:**
```bash
# Default: all supported collections
node dist/index.js fetch --source=govinfo-bulk

# Recommended first pass: BILLSTATUS only
node dist/index.js fetch --source=govinfo-bulk --collection=BILLSTATUS

# Narrow to one congress
node dist/index.js fetch --source=govinfo-bulk --collection=BILLSTATUS --congress=119

# Re-download a scope from scratch
node dist/index.js fetch --source=govinfo-bulk --collection=PLAW --force
```

### Supported collections
- `BILLSTATUS` — bill lifecycle/status XML (highest priority)
- `PLAW` — public/private law XML
- `BILLS` — full bill text XML (large)
- `BILLSUM` — bill summaries

### Behavior
- Walks GovInfo XML directory listings under `/bulkdata/`
- Preserves remote directory structure under `data/cache/govinfo-bulk/{collection}/{congress}/...`
- Downloads anonymously; **no API key required**
- Bounds local download concurrency at 2
- Uses manifest-backed resume semantics and skips already validated/extracted artifacts
- Validates XML payloads and rejects HTML/error bodies
- Validates ZIPs before marking them complete; `BILLSTATUS` requires parseable extracted XML

### Recommended acquisition order
1. `BILLSTATUS`
2. `PLAW`
3. `BILLSUM`
4. `BILLS`

### Cache layout
```text
data/cache/govinfo-bulk/
├── BILLSTATUS/
│   └── 119/hr/
│       ├── BILLSTATUS-119hr.xml.zip
│       └── extracted/
├── PLAW/
├── BILLS/
└── BILLSUM/
```

### Resume / status notes
- Resume state is tracked in `data/manifest.json` under `sources["govinfo-bulk"]`
- Completed artifacts are skipped when the file still exists, sizes still match when known, and required extraction directories are present
- Use `--force` to clear manifest state for the selected `--collection` / `--congress` scope and re-fetch it
- `fetch --all` intentionally does **not** include `govinfo-bulk`; bulk fetch remains an explicit operator action

---

## Phase 2: OLRC — US Code USLM XML

**What:** Download all USC titles as USLM XML from the Office of the Law Revision Counsel.

**Current release point:** Public Law 119-73 (01/23/2026)

**Source URL:** `https://uscode.house.gov/download/download.shtml`

**Known issue:** The OLRC website requires session cookies. The `fetch` CLI's raw `fetch()` calls don't send cookies, so requests 404. Tracked as a bug to fix in the OLRC client.

### Workaround: Manual download

```bash
# Option A: Download the all-in-one ZIP (~large)
mkdir -p data/cache/olrc
curl -sL -c /tmp/olrc-cookies.txt -b /tmp/olrc-cookies.txt \
  "https://uscode.house.gov/" > /dev/null
curl -sL -b /tmp/olrc-cookies.txt \
  "https://uscode.house.gov/download/releasepoints/us/pl/119/73/xml_uscAll@119-73.zip" \
  -o data/cache/olrc/xml_uscAll@119-73.zip

# Option B: Download individual title ZIPs (54 titles + appendices)
for f in $(curl -sL -b /tmp/olrc-cookies.txt \
  "https://uscode.house.gov/download/download.shtml" | \
  grep -oE 'releasepoints/us/pl/119/73/xml_usc[^"]+\.zip'); do
  echo "Downloading $f..."
  curl -sL -b /tmp/olrc-cookies.txt \
    "https://uscode.house.gov/download/$f" \
    -o "data/cache/olrc/$(basename $f)"
done
```

### Artifact inventory
- 60 individual title ZIPs (titles 1–54 + appendix titles 5a, 11a, 18a, 28a, 50a)
- Or 1 all-in-one ZIP (`xml_uscAll@119-73.zip`)
- Each ZIP contains USLM XML files per section

### After download
```bash
# Transform XML → markdown (Issue #1 transformer)
node dist/index.js transform --input data/cache/olrc/ --output data/output/titles/
```

### Verification
- [ ] All 60 ZIPs downloaded (or all-in-one extracted)
- [ ] XML files extractable and valid
- [ ] Transform produces markdown for all titles
- [ ] Section count roughly matches expectations (~15,000+ sections)

---

## Phase 2: VoteView — Historical Roll Call Votes

**What:** Download CSV files with every roll call vote back to 1789 and DW-NOMINATE ideology scores.

**Source URL:** `https://voteview.com/data`

```bash
node dist/index.js fetch --source=voteview
```

### Artifact inventory
- `HSall_members.csv` — All members with ideology scores
- `HSall_votes.csv` — All roll call vote metadata
- `HSall_rollcalls.csv` — Individual vote records
- **Total size:** ~500MB+

### Verification
- [ ] All 3 CSVs downloaded
- [ ] Row counts are sane (members ~12,000+, votes ~50,000+)
- [ ] CSV headers match expected schema

### Notes
- These are static files, no API. Re-download with `--force` to refresh.
- VoteView data is used later for vote record attribution on bill PRs.
- Not needed for the title backfill — can defer if disk space is tight.

---

## Phase 3: Legislators — @unitedstates Project

**What:** Download YAML files with legislator biographical data, term history, and committee info.

**Source URL:** `https://github.com/unitedstates/congress-legislators`

```bash
node dist/index.js fetch --source=legislators
```

### Artifact inventory
- `legislators-current.yaml` — Current members of Congress
- `legislators-historical.yaml` — All historical members
- `committees-current.yaml` — Current committee structure

### Cross-reference
If a fresh Congress.gov member snapshot exists in cache, the fetch also generates `data/cache/legislators/bioguide-crosswalk.json` — a mapping between Congress.gov bioguide IDs and the @unitedstates dataset.

Skip statuses (non-fatal):
- `skipped_missing_congress_cache` — No Congress.gov data yet
- `skipped_stale_congress_snapshot` — Congress data too old
- `skipped_incomplete_congress_snapshot` — Congress fetch didn't finish

### Verification
- [ ] All 3 YAML files downloaded
- [ ] YAML parses without errors
- [ ] Crosswalk generated (only if Congress.gov data exists)

---

## Phase 4: GovInfo — Public Laws (Statutes at Large)

**What:** Enumerate and download metadata for all public laws via the GovInfo API. This is the foundation for future historical commit reconstruction.

**Source URL:** `https://api.govinfo.gov/`

**Requires:** `API_DATA_GOV_KEY` env var

**Shares rate budget with Phase 5** — 5,000 requests per rolling hour combined.

```bash
# Start the crawl
node dist/index.js fetch --source=govinfo

# Resume after rate limit exhaustion (automatic via manifest checkpoint)
node dist/index.js fetch --source=govinfo

# Force restart from scratch
node dist/index.js fetch --source=govinfo --force
```

### How it works
1. Pages through PLAW collection listing
2. For each package: fetches summary + granules metadata
3. Interleaved: listing page → per-package detail → next listing page
4. Checkpoints progress in `data/manifest.json`
5. On 429: stops with `rate_limit_exhausted`, records `next_request_at`

### Rate limit strategy
- Rolling hour window, ceiling 5,000 requests
- Shared with Congress.gov (whichever runs first burns the budget)
- `Retry-After` header honored if present
- **Run GovInfo and Congress.gov in separate hours, not concurrently**

### Estimated time
- Thousands of public laws across all congresses
- Each law = 2-3 API calls (listing entry + summary + granules)
- At 5,000 req/hr: ~1,500-2,500 laws per hour
- Full crawl: **several hourly sessions** spread over 1-2 days

### Verification
- [ ] `data/manifest.json` shows GovInfo progress
- [ ] `data/cache/govinfo/` has summary + granules JSON per package
- [ ] No corrupt/partial JSON files
- [ ] `fetch --status` shows incremental progress

### What this unlocks
- Public law enactment dates → enables backdated commits in `us-code`
- Public law → title/section mapping → enables attributing code changes to specific laws
- Foundation for the historical commit chain (Phase 4 of the project roadmap)

---

## Phase 5: Congress.gov — Bills, Members, Committees

**What:** Bulk download of all bills, member profiles, and committee data across congresses 93–current (119).

**Source URL:** `https://api.congress.gov/v3/`

**Requires:** `API_DATA_GOV_KEY` env var

**Shares rate budget with Phase 4.**

```bash
# Start bulk crawl (begins at congress 93 or resumes from checkpoint)
node dist/index.js fetch --source=congress

# Fetch only current congress
node dist/index.js fetch --source=congress --congress=119

# Force restart from congress 93
node dist/index.js fetch --source=congress --force
```

### How it works
1. Resolves current congress number via `GET /congress/current` (cached per process)
2. Iterates congresses 93 → current
3. Per congress: paginates all bills, fetches detail/actions/cosponsors per bill, committees
4. Global member snapshot: all members + per-member detail
5. Checkpoints last completed congress in `data/manifest.json`

### Rate limit strategy
Same shared 5,000 req/hr budget as GovInfo. **Do not run concurrently.**

### Estimated time
- 27 congresses × thousands of bills × 3-4 API calls per bill
- At 5,000 req/hr: maybe 1 congress per hour (rough estimate, varies by bill count)
- Full historical crawl: **days to weeks** of hourly sessions
- **Tip:** Run `--congress=119` first for a quick smoke test (~1 hour)

### Checkpoint/resume
- Manifest tracks `last_completed_congress`
- Non-`--force` runs resume from the next congress after the checkpoint
- Safe to interrupt and restart anytime

### Verification
- [ ] `data/manifest.json` shows Congress progress per congress number
- [ ] `data/cache/congress/` has bill JSON, member JSON, committee JSON
- [ ] Member snapshot complete (check member count)
- [ ] `fetch --status` shows congress-by-congress progress

### What this unlocks
- Bill metadata for "bills as PRs" (sponsors, timeline, cosponsors)
- Member profiles for commit attribution
- Committee data for PR labels
- Cross-reference with legislators dataset (bioguide IDs)

---

## Running `--all`

```bash
node dist/index.js fetch --all
```

Runs all 5 sources sequentially. Each source produces its own result — **fail-open**: later sources run regardless of earlier failures. Exit code 1 if any source failed.

**Not recommended for initial acquisition** — use individual source commands to control rate budget allocation. Use `--all` for periodic refresh once the initial crawl is complete.

---

## Monitoring

```bash
# Check what's cached and when
node dist/index.js fetch --status

# Inspect manifest directly
cat data/manifest.json | jq .
```

---

## Loading into us-code Repo

After Phase 1 (OLRC) completes:

### Step 1: Transform XML → Markdown
```bash
node dist/index.js transform --input data/cache/olrc/ --output data/output/titles/
```

### Step 2: Review output structure
```
data/output/titles/
├── title-01/
│   ├── chapter-1/
│   │   ├── section-1.md
│   │   ├── section-2.md
│   │   └── ...
│   └── ...
├── title-02/
│   └── ...
└── title-54/
```

### Step 3: Load baseline into us-code
```bash
cd /path/to/us-code
# Copy transformed markdown
cp -r /path/to/us-code-tools/data/output/titles/* .

# Commit as baseline snapshot
git add .
git commit --author="OLRC <olrc@uscode.house.gov>" \
  --date="2026-01-23T00:00:00Z" \
  -m "Baseline: US Code current through P.L. 119-73 (2026-01-23)

Source: Office of the Law Revision Counsel
Release point: Public Law 119-73
Titles: 1-54 (plus appendices)
Format: USLM XML → Markdown"
```

### Step 4: Validate
- [ ] Section count matches XML source
- [ ] Spot-check 5-10 sections across different titles
- [ ] `git log --stat` shows reasonable file counts
- [ ] Push to `us-code` repo

---

## Known Issues

### OLRC Cookie Bug
The OLRC website (`uscode.house.gov`) requires a session cookie to serve download pages. Without it, requests return 404. The `fetch --source=olrc` CLI uses raw `fetch()` which doesn't handle cookies. **Workaround:** Manual curl download with cookie jar (see Phase 1).

**Fix:** Update OLRC client to either:
- Use a cookie jar with `fetch()`
- Pre-visit the homepage to establish a session
- Or download via the all-in-one ZIP URL pattern (if stable)

### Shared Rate Budget Coordination
Congress.gov and GovInfo share a 5,000 req/hr rolling budget. Running both concurrently will exhaust the budget faster. **Best practice:** Run them in alternating hours or separate sessions.

### Historical Archives
OLRC publishes prior release points and annual historical archives. These could enable year-over-year diffs for historical commit reconstruction but are not yet explored. URLs:
- Prior release points: `https://uscode.house.gov/download/priorreleasepoints.htm`
- Annual archives: `https://uscode.house.gov/download/annualhistoricalarchives/annualhistoricalarchives.htm`

---

## Recommended Execution Order

### Today (no API key needed)
1. ✅ Download OLRC XML (Phase 1, manual curl)
2. ✅ Transform to markdown
3. ✅ Load baseline into `us-code` repo

### This week (API key ready)
4. Download VoteView CSVs (Phase 2, ~10 min)
5. Download Legislators YAMLs (Phase 3, ~10 sec)
6. Smoke test: `fetch --source=congress --congress=119` (~1 hour)
7. Smoke test: `fetch --source=govinfo` (run until first rate limit hit)

### Ongoing (days–weeks)
8. Congress.gov historical crawl — run `fetch --source=congress` hourly
9. GovInfo crawl — run `fetch --source=govinfo` in alternating hours
10. Re-run legislators once Congress snapshot is complete (for crosswalk)

### After all data acquired
11. Build historical commit chain from GovInfo public law dates
12. Enrich PRs with Congress.gov bill metadata
13. Attribute votes from VoteView
14. Cross-reference legislators for author metadata
