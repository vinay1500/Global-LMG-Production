import { describe, expect, it } from 'vitest';
import { validateRequestDocumentUploadRows } from '../../backend/src/modules/dashboard/normalizedRepository.js';

const now = new Date('2026-05-09T00:00:00.000Z');

const uploadRow = (overrides: Record<string, unknown> = {}) =>
  ({
    document_id: 10,
    document_version_id: 20,
    expires_at: '2026-05-09 00:10:00.000000',
    invoice_public_id: null,
    is_attached_to_request: 0,
    matter_public_id: null,
    public_id: 'upload_public_id',
    request_public_id: null,
    resolved_document_id: 10,
    resolved_document_version_id: 20,
    status_code: 'stored',
    thread_public_id: null,
    ...overrides,
  }) as never;

const expectUploadRejection = (
  rows: never[],
  expectedCount: number,
  expectedCode: string,
  expectedStatus: number
) => {
  try {
    validateRequestDocumentUploadRows(rows, expectedCount, now);
    throw new Error('Expected upload validation to fail.');
  } catch (error) {
    expect(error).toMatchObject({
      code: expectedCode,
      statusCode: expectedStatus,
    });
  }
};

describe('request document upload ownership validation', () => {
  it('accepts an owned completed upload with a stored document version', () => {
    expect(() => validateRequestDocumentUploadRows([uploadRow()], 1, now)).not.toThrow();
  });

  it('rejects unknown or foreign upload ids', () => {
    expectUploadRejection([], 1, 'request_document_forbidden', 403);
  });

  it('rejects expired upload ids', () => {
    expectUploadRejection(
      [uploadRow({ expires_at: '2026-05-08 23:59:59.000000' })],
      1,
      'request_document_expired',
      409
    );
  });

  it('rejects incomplete uploads without a stored document version', () => {
    expectUploadRejection(
      [
        uploadRow({
          document_version_id: null,
          resolved_document_version_id: null,
          status_code: 'pending',
        }),
      ],
      1,
      'request_document_not_ready',
      409
    );
  });

  it('rejects uploads already linked to another request', () => {
    expectUploadRejection(
      [uploadRow({ is_attached_to_request: 1, request_public_id: 'existing_request' })],
      1,
      'request_document_already_linked',
      409
    );
  });
});
