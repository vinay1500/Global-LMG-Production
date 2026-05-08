import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createSignature,
  verifyRazorpaySignature,
} from '../../backend/src/modules/payments/razorpayService.js';

const secret = 'test_razorpay_secret_123';
const orderId = 'order_test_123';
const paymentId = 'pay_test_456';
const message = `${orderId}|${paymentId}`;

const sign = (value: string, signingSecret = secret) =>
  crypto.createHmac('sha256', signingSecret).update(value).digest('hex');

describe('Razorpay signature helpers', () => {
  it('creates deterministic HMAC-SHA256 signatures', () => {
    expect(createSignature(message, secret)).toBe(sign(message));
    expect(createSignature(message, secret)).toHaveLength(64);
  });

  it('verifies a correctly signed Razorpay checkout message', () => {
    expect(
      verifyRazorpaySignature({
        message,
        secret,
        signature: sign(message),
      })
    ).toBe(true);
  });

  it('rejects a tampered message', () => {
    expect(
      verifyRazorpaySignature({
        message: `${orderId}|pay_tampered_789`,
        secret,
        signature: sign(message),
      })
    ).toBe(false);
  });

  it('rejects signatures verified with the wrong secret', () => {
    expect(
      verifyRazorpaySignature({
        message,
        secret: 'wrong_test_secret_456',
        signature: sign(message),
      })
    ).toBe(false);
  });

  it('rejects non-hex signatures cleanly', () => {
    expect(
      verifyRazorpaySignature({
        message,
        secret,
        signature: 'not-a-valid-hex-signature',
      })
    ).toBe(false);
  });

  it('fails safely for hex signatures with the wrong length', () => {
    expect(
      verifyRazorpaySignature({
        message,
        secret,
        signature: 'a'.repeat(62),
      })
    ).toBe(false);
  });
});
