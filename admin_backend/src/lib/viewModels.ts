type StageCode =
  | 'request-received'
  | 'verification-call'
  | 'consultation'
  | 'action-plan'
  | 'resolution';

const STAGE_FLOW: Array<{ code: StageCode; label: string }> = [
  { code: 'request-received', label: 'Request Received' },
  { code: 'verification-call', label: 'Verification Call' },
  { code: 'consultation', label: 'Consultation' },
  { code: 'action-plan', label: 'Action Plan' },
  { code: 'resolution', label: 'Resolution' },
];

const toIso = (value: string | null | undefined) => {
  if (!value) {
    return '';
  }

  return value.replace(' ', 'T');
};

const toDateOnly = (value: string | null | undefined) => {
  return value ? value.slice(0, 10) : '';
};

const toTimeLabel = (value: string | null | undefined) => {
  if (!value) {
    return '';
  }

  const date = new Date(toIso(value));
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const buildMatterStages = (currentStageCode: string) => {
  const currentIndex = STAGE_FLOW.findIndex((stage) => stage.code === currentStageCode);
  return STAGE_FLOW.map((stage, index) => ({
    completed: currentIndex >= 0 ? index <= currentIndex : false,
    id: stage.code,
    label: stage.label,
  }));
};

export const mapLifecycle = (accountStatusCode: string, onboardingStatusCode: string) => {
  if (accountStatusCode === 'active') {
    return 'client';
  }

  if (onboardingStatusCode === 'registered') {
    return 'registered';
  }

  if (onboardingStatusCode === 'consultation-scheduled') {
    return 'consultation-scheduled';
  }

  if (onboardingStatusCode === 'consultation-completed') {
    return 'consultation-completed';
  }

  if (onboardingStatusCode === 'fee-pending') {
    return 'fee-pending';
  }

  if (accountStatusCode === 'archived') {
    return 'archived';
  }

  return 'lead';
};

export const mapMatterPriority = (operationalStatusCode: string, urgencyCode: string) => {
  if (operationalStatusCode === 'completed') {
    return 'completed';
  }

  if (operationalStatusCode === 'awaiting-client') {
    return 'awaiting-client';
  }

  if (operationalStatusCode === 'awaiting-team') {
    return 'awaiting-team';
  }

  if (urgencyCode === 'within-2hrs' || urgencyCode === 'within-6hrs' || operationalStatusCode === 'immediate') {
    return 'immediate-6h';
  }

  return 'in-progress';
};

export const mapVisibility = (visibilityScopeCode: string) =>
  visibilityScopeCode.toLowerCase().includes('internal') ? 'internal' : 'client';

export const mapReviewState = (virusScanStatusCode: string) =>
  virusScanStatusCode === 'clean' ? 'reviewed' : 'unreviewed';

export const toUiDateTime = toIso;
export const toUiDate = toDateOnly;
export const toUiTime = toTimeLabel;
