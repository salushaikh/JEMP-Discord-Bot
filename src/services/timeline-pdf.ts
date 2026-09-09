import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';

type TimelinePdfInput = {
  jempId: string;
  generatedAt: Date;
  events: Array<{ occurredAt: Date; title: string; summary: string | null; source: string; entityExternalId: string | null }>;
};

/** A professional, view-only snapshot. The canonical event data remains immutable in PostgreSQL. */
export function createTimelinePdf(input: TimelinePdfInput): Promise<Buffer> {
  const sealPayload = JSON.stringify(input.events.map((event) => [event.occurredAt.toISOString(), event.title, event.summary, event.source, event.entityExternalId]));
  const seal = createHash('sha256').update(sealPayload).digest('hex');
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 54, info: { Title: `${input.jempId} — JEMP Proof of Work`, Author: 'Jobless Empire', Subject: 'View-only canonical Timeline snapshot' } });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    document.fillColor('#981f1f').fontSize(11).text('JOBLESS EMPIRE · CANONICAL PROOF OF WORK');
    document.fillColor('#161212').fontSize(25).text(input.jempId, { continued: false });
    document.fillColor('#5d5252').fontSize(10).text('Jobless doesn’t mean useless. No job. Still building.');
    document.moveDown(1.5);
    document.strokeColor('#981f1f').lineWidth(1).moveTo(document.x, document.y).lineTo(540, document.y).stroke();
    document.moveDown();
    if (!input.events.length) document.fillColor('#5d5252').fontSize(11).text('No canonical Timeline entries have been recorded yet.');
    for (const event of input.events) {
      const date = event.occurredAt.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
      document.fillColor('#981f1f').fontSize(9).text(date.toUpperCase());
      document.fillColor('#161212').fontSize(13).text(event.title);
      if (event.summary) document.fillColor('#3e3838').fontSize(10).text(event.summary);
      document.fillColor('#756a6a').fontSize(8).text(`Official source: ${event.source}${event.entityExternalId ? ` · ${event.entityExternalId}` : ''}`);
      document.moveDown(0.9);
      if (document.y > 730) document.addPage();
    }
    document.moveDown();
    document.strokeColor('#981f1f').lineWidth(0.5).moveTo(document.x, document.y).lineTo(540, document.y).stroke();
    document.moveDown(0.5).fillColor('#756a6a').fontSize(8).text(`Generated ${input.generatedAt.toISOString()} · Record seal SHA-256: ${seal}`);
    document.fillColor('#756a6a').fontSize(8).text('This view-only document is a point-in-time rendering of immutable canonical JEMP Timeline records. Verify its seal against the JEMP service if required.');
    document.end();
  });
}
