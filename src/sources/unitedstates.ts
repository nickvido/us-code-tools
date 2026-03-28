export interface UnitedStatesResult {
  source: 'legislators';
  ok: boolean;
  requested_scope: { files: string[] };
  error?: { code: string; message: string };
}

export async function fetchUnitedStatesSource(): Promise<UnitedStatesResult> {
  return {
    source: 'legislators',
    ok: false,
    requested_scope: {
      files: ['legislators-current.yaml', 'legislators-historical.yaml', 'committees-current.yaml'],
    },
    error: {
      code: 'not_implemented',
      message: 'UnitedStates acquisition is not implemented yet',
    },
  };
}
