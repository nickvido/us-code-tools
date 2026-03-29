export interface ReleaseSummaryCounts {
  titles_changed: number;
  chapters_changed: number;
  sections_added: number;
  sections_amended: number;
  sections_repealed: number;
}

export interface ReleaseNotes {
  scope: 'annual' | 'congress';
  notable_laws: string[];
  summary_counts: ReleaseSummaryCounts;
  narrative: string;
}

export interface AnnualSnapshotRow {
  annual_tag: string;
  snapshot_date: string;
  release_point: string;
  commit_selector: string;
  congress: number;
  president_term: string;
  is_congress_boundary: boolean;
  release_notes: ReleaseNotes;
}

export interface PresidentTermRow {
  slug: string;
  inauguration_date: string;
  president_name: string;
}

export interface LegalMilestonesMetadata {
  annual_snapshots: AnnualSnapshotRow[];
  president_terms: PresidentTermRow[];
}

export interface AnnualTagPlan {
  tag: string;
  commit_sha: string;
  snapshot_date: string;
}

export interface PlTagPlan {
  tag: string;
  commit_sha: string;
  release_point: string;
}

export interface CongressTagPlan {
  tag: string;
  commit_sha: string;
  annual_tag: string;
}

export interface PresidentTagPlan {
  tag: string;
  commit_sha: string;
  annual_tag: string;
  slug: string;
  inauguration_date: string;
}

export interface SkippedPresidentTag {
  slug: string;
  inauguration_date: string;
  reason: 'inauguration_before_coverage_window' | 'no_snapshot_on_or_after_inauguration';
}

export interface ReleaseCandidate {
  tag: string;
  tag_sha: string;
  previous_tag: string | null;
  previous_tag_sha: string | null;
  title: string;
  start_date: string;
  end_date: string;
}

export interface PlanError {
  code: string;
  message: string;
}

export interface MilestonesPlan {
  annual_tags: AnnualTagPlan[];
  pl_tags: PlTagPlan[];
  congress_tags: CongressTagPlan[];
  president_tags: Array<Pick<PresidentTagPlan, 'tag' | 'commit_sha' | 'annual_tag'>>;
  skipped_president_tags: SkippedPresidentTag[];
  release_candidates: ReleaseCandidate[];
  errors: PlanError[];
}

export interface ManifestAnnualRow {
  annual_tag: string;
  annual_tag_sha: string;
  pl_tag: string;
  pl_tag_sha: string;
  snapshot_date: string;
  release_point: string;
  congress: number;
  president_term: string;
  commit_sha: string;
  is_congress_boundary: boolean;
}

export interface MilestonesManifest {
  version: 1;
  metadata: {
    path: string;
    sha256: string;
  };
  annual_rows: ManifestAnnualRow[];
  congress_tags: Array<{ tag: string; congress: number; commit_sha: string; annual_tag: string }>;
  president_tags: Array<{ tag: string; slug: string; inauguration_date: string; commit_sha: string; annual_tag: string }>;
  skipped_president_tags: SkippedPresidentTag[];
  release_candidates: ReleaseCandidate[];
}

export interface PlannedAnnualRow extends AnnualSnapshotRow {
  commit_sha: string;
  pl_tag: string;
}
