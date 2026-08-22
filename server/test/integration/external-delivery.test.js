import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, renderReportPdf } from '../../src/lib/pdf.js';
import { sendHealthReportEmail } from '../../src/lib/mailer.js';

const pdfEnabled = process.env.RUN_PDF_E2E === '1';
const smtpEnabled = process.env.RUN_SMTP_E2E === '1';

describe('external PDF integration', { skip: !pdfEnabled }, () => {
  after(closeBrowser);

  it('renders a real report page into a PDF', async () => {
    const token = process.env.TEST_PUBLIC_REPORT_TOKEN?.trim();
    assert.ok(token, 'RUN_PDF_E2E=1 時必須設定 TEST_PUBLIC_REPORT_TOKEN');
    const pdf = await renderReportPdf(token);
    assert.equal(Buffer.from(pdf).subarray(0, 4).toString(), '%PDF');
  });
});

describe('external SMTP integration', { skip: !smtpEnabled }, () => {
  it('sends one explicitly opted-in test message', async () => {
    const recipient = process.env.TEST_SMTP_TO?.trim();
    assert.ok(recipient, 'RUN_SMTP_E2E=1 時必須設定 TEST_SMTP_TO');
    const info = await sendHealthReportEmail({
      to: recipient,
      ownerName: '整合測試',
      petName: '測試寵物',
      reportNumber: `SMTP-E2E-${Date.now()}`,
      reportUrl: process.env.PUBLIC_APP_URL || 'https://example.invalid/report/test',
      pdfBuffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
    });
    assert.ok(info.messageId || info.accepted?.length);
  });
});
