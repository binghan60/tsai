import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reportPdfFilename } from '../../../shared/reportFilename.js';

describe('reportPdfFilename', () => {
  it('貓咪名＿健檢報告＿診所時區的健檢日期', () => {
    // UTC 9/26 17:00 是台北 9/27 凌晨一點。
    assert.equal(reportPdfFilename({ petName: '豆豆', visitDate: '2026-09-26T17:00:00.000Z' }), '豆豆_健檢報告_2026-09-27.pdf');
  });

  it('檔名不接受的字元換成底線', () => {
    assert.equal(reportPdfFilename({ petName: 'A/B:C', visitDate: '2026-09-27T02:00:00.000Z' }), 'A_B_C_健檢報告_2026-09-27.pdf');
  });

  it('缺名字或日期就省略那一段', () => {
    assert.equal(reportPdfFilename({ petName: '', visitDate: null }), '健檢報告.pdf');
    assert.equal(reportPdfFilename({ petName: '豆豆', visitDate: 'not a date' }), '豆豆_健檢報告.pdf');
  });
});
