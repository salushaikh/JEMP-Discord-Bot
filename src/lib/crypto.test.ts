import { describe, expect, it } from 'vitest';
import { decrypt, emailHash, encrypt, normalizeEmail, signBody } from './crypto.js';

const key = Buffer.alloc(32, 7).toString('base64');

describe('JEMP privacy primitives', () => {
  it('normalizes application email consistently without retaining plaintext in the lookup hash', () => {
    expect(normalizeEmail('  MEMBER@Example.COM ')).toBe('member@example.com');
    expect(emailHash('MEMBER@example.com')).toBe(emailHash('member@example.com'));
    expect(emailHash('member@example.com')).not.toContain('member@example.com');
  });

  it('encrypts profile fields with a unique IV and decrypts them accurately', () => {
    const first = encrypt('private résumé link', key);
    const second = encrypt('private résumé link', key);
    expect(first).not.toBe(second);
    expect(decrypt(first, key)).toBe('private résumé link');
  });

  it('makes a deterministic HMAC for exact Timeline request bodies', () => {
    expect(signBody('{"title":"Update"}', 'a'.repeat(32))).toBe(signBody('{"title":"Update"}', 'a'.repeat(32)));
    expect(signBody('{"title":"Update"}', 'a'.repeat(32))).not.toBe(signBody('{"title":"update"}', 'a'.repeat(32)));
  });
});
