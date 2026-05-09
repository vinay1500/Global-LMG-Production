import { describe, expect, it } from 'vitest';
import {
  isMessageContentWithinLimit as isClientMessageContentWithinLimit,
  sanitizeMessageContent as sanitizeClientMessageContent,
} from '../../backend/src/lib/messageContent.js';
import {
  isMessageContentWithinLimit as isAdminMessageContentWithinLimit,
  sanitizeMessageContent as sanitizeAdminMessageContent,
} from '../../admin_backend/src/lib/messageContent.js';

const helpers = [
  {
    isWithinLimit: isClientMessageContentWithinLimit,
    name: 'client messages',
    sanitize: sanitizeClientMessageContent,
  },
  {
    isWithinLimit: isAdminMessageContentWithinLimit,
    name: 'admin messages',
    sanitize: sanitizeAdminMessageContent,
  },
];

describe.each(helpers)('$name plain-text message sanitizer', ({ isWithinLimit, sanitize }) => {
  it('escapes script tags while preserving readable text', () => {
    const result = sanitize('Before <script>alert(1)</script> After');

    expect(result).toBe('Before &lt;script&gt;alert(1)&lt;/script&gt; After');
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('</script>');
  });

  it('escapes image tags with event handlers instead of storing executable HTML', () => {
    const result = sanitize('Evidence <img src=x onerror=alert(1)> attached');

    expect(result).toBe('Evidence &lt;img src=x onerror=alert(1)&gt; attached');
    expect(result).not.toContain('<img');
    expect(result).not.toContain('>');
  });

  it('normalizes line endings and preserves line breaks', () => {
    expect(sanitize('First line\r\nSecond line\rThird line')).toBe(
      'First line\nSecond line\nThird line'
    );
  });

  it('enforces the configured message length before persistence', () => {
    expect(isWithinLimit('a'.repeat(5000), 5000)).toBe(true);
    expect(isWithinLimit('a'.repeat(5001), 5000)).toBe(false);
  });
});
