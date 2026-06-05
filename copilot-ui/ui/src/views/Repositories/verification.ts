export type VerificationState = 'missing' | 'stale' | 'verified' | 'partial' | 'failed';

export function computeVerificationState(params: {
  hasCheckRun: boolean;
  checkPassed: boolean;
  branch: string | null;
  headAtRun: string | null;
  currentHead: string | null;
  changeCountAtRun: number;
  currentChangeCount: number;
  ciStatus: 'passed' | 'failed' | 'pending' | 'not-found' | 'unavailable';
}): VerificationState {
  const {
    hasCheckRun,
    checkPassed,
    branch: _branch,
    headAtRun,
    currentHead,
    changeCountAtRun,
    currentChangeCount,
    ciStatus,
  } = params;

  if (!hasCheckRun) return 'missing';

  const headChanged = headAtRun && currentHead && headAtRun !== currentHead;
  const changesChanged = changeCountAtRun !== currentChangeCount;
  if (headChanged || changesChanged) return 'stale';

  if (!checkPassed) return 'failed';

  if (ciStatus === 'failed') return 'failed';
  if (ciStatus === 'pending' || ciStatus === 'not-found') return 'partial';

  return 'verified';
}

export function verificationLabel(state: VerificationState): string {
  switch (state) {
    case 'verified': return 'Checks passed';
    case 'partial': return 'Local checks passed, CI pending';
    case 'failed': return 'Checks failed';
    case 'stale': return 'Checks stale';
    case 'missing': return 'Checks not run';
  }
}

export function verificationTone(state: VerificationState): 'success' | 'brand' | 'danger' | 'neutral' {
  switch (state) {
    case 'verified': return 'success';
    case 'partial': return 'brand';
    case 'failed': return 'danger';
    case 'stale':
    case 'missing': return 'neutral';
  }
}
