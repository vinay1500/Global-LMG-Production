import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadsApi } from './uploads';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('uploads API checksum support', () => {
  it('fails gracefully without Web Crypto subtle support', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('crypto', {});
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      uploadsApi.uploadFiles([new File(['hello'], 'test.txt', { type: 'text/plain' })], {
        sourceModule: 'unit-test',
      })
    ).rejects.toMatchObject({
      code: 'secure_context_required',
      message: 'Secure browser context is required for document uploads.',
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
