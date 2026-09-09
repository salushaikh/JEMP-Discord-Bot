import { describe, expect, it } from 'vitest';
import { createTimelinePdf } from './timeline-pdf.js';

describe('Timeline PDF export', () => {
  it('creates a view-only PDF document from canonical events', async () => {
    const document = await createTimelinePdf({
      jempId: 'JEMP#0042',
      generatedAt: new Date('2026-09-09T00:00:00.000Z'),
      events: [{ occurredAt: new Date('2026-09-08T00:00:00.000Z'), title: 'Shipped a dashboard', summary: 'Implemented the member dashboard.', source: 'project', entityExternalId: 'P#003' }]
    });
    expect(document.subarray(0, 4).toString()).toBe('%PDF');
    expect(document.length).toBeGreaterThan(500);
  });
});
