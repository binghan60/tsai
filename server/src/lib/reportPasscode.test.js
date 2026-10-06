import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PDFDocument } from '@cantoo/pdf-lib';
import { createFailureLimiter, reportPasscode, reportPasscodeMatches } from './reportPasscode.js';
import { encryptPdf } from './pdfEncrypt.js';

describe('reportPasscode', () => {
  it('取手機的後 6 碼', () => {
    assert.equal(reportPasscode('0912345678'), '345678');
    assert.equal(reportPasscode('0912-345-678'), '345678');
  });

  it('舊資料的市話一樣取數字後 6 碼', () => {
    assert.equal(reportPasscode('(02) 2345-6789'), '456789');
  });

  it('湊不滿 6 碼就沒有密碼', () => {
    assert.equal(reportPasscode(''), '');
    assert.equal(reportPasscode(null), '');
    assert.equal(reportPasscode('12345'), '');
  });
});

describe('reportPasscodeMatches', () => {
  it('只看數字', () => {
    assert.equal(reportPasscodeMatches('345678', '345678'), true);
    assert.equal(reportPasscodeMatches(' 345-678 ', '345678'), true);
  });

  it('不對或沒給都不過', () => {
    assert.equal(reportPasscodeMatches('345679', '345678'), false);
    assert.equal(reportPasscodeMatches('45678', '345678'), false);
    assert.equal(reportPasscodeMatches('', '345678'), false);
    assert.equal(reportPasscodeMatches(undefined, '345678'), false);
  });

  it('沒有密碼的報告一律放行', () => {
    assert.equal(reportPasscodeMatches('', ''), true);
  });
});

describe('createFailureLimiter', () => {
  it('錯到上限就擋，時間過了放行', () => {
    let now = 0;
    const limiter = createFailureLimiter({ windowMs: 1000, max: 2, now: () => now });
    limiter.fail('a');
    assert.equal(limiter.retryAfterSeconds('a'), 0);
    limiter.fail('a');
    assert.equal(limiter.retryAfterSeconds('a'), 1);
    assert.equal(limiter.retryAfterSeconds('b'), 0);
    now = 1000;
    assert.equal(limiter.retryAfterSeconds('a'), 0);
  });
});

describe('encryptPdf', () => {
  async function samplePdf() {
    const document = await PDFDocument.create();
    document.addPage();
    return Buffer.from(await document.save());
  }

  it('加密後要密碼才打得開', async () => {
    const encrypted = await encryptPdf(await samplePdf(), '345678');
    assert.equal(encrypted.subarray(0, 5).toString(), '%PDF-');
    await assert.rejects(PDFDocument.load(encrypted));
    await assert.rejects(PDFDocument.load(encrypted, { password: '000000' }));
    const opened = await PDFDocument.load(encrypted, { password: '345678' });
    assert.equal(opened.getPageCount(), 1);
  });

  it('沒有密碼就原檔交出', async () => {
    const plain = await samplePdf();
    assert.equal(await encryptPdf(plain, ''), plain);
  });
});
