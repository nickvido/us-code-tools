export interface VoteViewResult {
  source: 'voteview';
  ok: boolean;
  requested_scope: { files: string[] };
  error?: { code: string; message: string };
}

export async function fetchVoteViewSource(): Promise<VoteViewResult> {
  return {
    source: 'voteview',
    ok: false,
    requested_scope: {
      files: ['HSall_members.csv', 'HSall_votes.csv', 'HSall_rollcalls.csv'],
    },
    error: {
      code: 'not_implemented',
      message: 'VoteView acquisition is not implemented yet',
    },
  };
}
