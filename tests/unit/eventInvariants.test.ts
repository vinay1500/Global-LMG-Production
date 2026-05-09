import { beforeAll, describe, expect, it } from 'vitest';

let assertEventMatterBelongsToClient: typeof import('../../admin_backend/src/modules/events/service.js')['assertEventMatterBelongsToClient'];

beforeAll(async () => {
  process.env.APP_ENV ||= 'development';
  process.env.AUTH_SESSION_SECRET ||= 'test-admin-session-secret-with-enough-length';
  ({ assertEventMatterBelongsToClient } = await import('../../admin_backend/src/modules/events/service.js'));
});

describe('admin event client and matter invariants', () => {
  it('allows an event when the matter belongs to the selected client', () => {
    expect(() =>
      assertEventMatterBelongsToClient({
        clientAccountId: 42,
        matterClientAccountId: 42,
      })
    ).not.toThrow();
  });

  it('rejects an event that links a matter to a different client', () => {
    let thrown: unknown;
    try {
      assertEventMatterBelongsToClient({
        clientAccountId: 7,
        matterClientAccountId: 42,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: 'event_client_matter_mismatch',
      statusCode: 400,
    });
  });
});
