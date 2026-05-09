import type { LifecycleStage } from './adminTypes';

export const LIFECYCLE_STAGES: { id: LifecycleStage; label: string }[] = [
  { id: 'request-received', label: 'Request Received' },
  { id: 'verification-call', label: 'Verification Call' },
  { id: 'consultation', label: 'Consultation' },
  { id: 'action-plan', label: 'Action Plan' },
  { id: 'resolution', label: 'Resolution' },
];

export const getServiceName = (id: string) => id;
