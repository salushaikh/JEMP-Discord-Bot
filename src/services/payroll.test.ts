import { describe, expect, it } from 'vitest';
import { DomainError } from '../lib/errors.js';
import { calculatePayment } from './payroll.js';

describe('transparent payroll calculations', () => {
  it('separates the 5% administration fee from the work pool', () => {
    expect(calculatePayment(100_000, 500)).toEqual({ adminFeeMinor: 5_000, workPoolMinor: 95_000 });
  });

  it('rejects negative and impossible payment inputs', () => {
    expect(() => calculatePayment(0, 500)).toThrow(DomainError);
    expect(() => calculatePayment(100, 10_001)).toThrow(DomainError);
  });
});
