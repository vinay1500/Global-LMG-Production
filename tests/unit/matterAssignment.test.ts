import type { ZodType } from 'zod';
import { beforeAll, describe, expect, it } from 'vitest';

const baseAssignment = {
  assignmentRoleCode: 'external_counsel',
};

let assignmentSchema: ZodType;

beforeAll(async () => {
  process.env.AUTH_SESSION_SECRET ||= 'test-admin-session-secret-with-enough-length';
  ({ assignmentSchema } = await import('../../admin_backend/src/routes/matters.js'));
});

const expectAssignmentValid = (payload: unknown) => {
  expect(assignmentSchema.safeParse(payload).success).toBe(true);
};

const expectAssignmentInvalid = (payload: unknown, message: string) => {
  const result = assignmentSchema.safeParse(payload);

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues.map((issue) => issue.message)).toContain(message);
  }
};

describe('matter assignment fee validation', () => {
  it('accepts matching paid and due amounts within the agreed amount', () => {
    expectAssignmentValid({
      ...baseAssignment,
      feeAgreedAmount: 100,
      feePaidAmount: 40,
      feeDueAmount: 60,
    });
  });

  it('accepts paid plus due within the rounding tolerance', () => {
    expectAssignmentValid({
      ...baseAssignment,
      feeAgreedAmount: 100,
      feePaidAmount: 40,
      feeDueAmount: 60.01,
    });
  });

  it('rejects paid amount above the agreed amount plus tolerance', () => {
    expectAssignmentInvalid(
      {
        ...baseAssignment,
        feeAgreedAmount: 100,
        feePaidAmount: 100.02,
        feeDueAmount: 0,
      },
      'Paid amount cannot exceed agreed amount.'
    );
  });

  it('rejects due amount above the agreed amount plus tolerance', () => {
    expectAssignmentInvalid(
      {
        ...baseAssignment,
        feeAgreedAmount: 100,
        feePaidAmount: 0,
        feeDueAmount: 100.02,
      },
      'Due amount cannot exceed agreed amount.'
    );
  });

  it('rejects paid plus due above the agreed amount plus tolerance', () => {
    expectAssignmentInvalid(
      {
        ...baseAssignment,
        feeAgreedAmount: 100,
        feePaidAmount: 60,
        feeDueAmount: 40.02,
      },
      'Paid plus due cannot exceed agreed amount.'
    );
  });

  it('preserves optional fee-field behavior when fee amounts are omitted', () => {
    expectAssignmentValid(baseAssignment);
  });
});
