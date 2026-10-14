import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DELIVERY_STATUS_META, RECORD_STATUS_META, deskMark, visitDeskMarks, getAvailabilityStatusMeta, getDeliveryStatus, isFinalizedRecord, reportMark, reportMarkNote } from './recordStatus.js';

describe('record status helpers', () => {
  it('keeps lifecycle and delivery state independent', () => {
    assert.equal(isFinalizedRecord({ status: 'finalized', deliveryStatus: 'failed' }), true);
    assert.equal(isFinalizedRecord({ status: 'draft', deliveryStatus: 'not_sent' }), false);
    assert.equal(getDeliveryStatus({ status: 'finalized' }), 'not_sent');
  });

  it('uses one canonical presentation for workflow and availability statuses', () => {
    assert.equal(RECORD_STATUS_META.draft.label, '草稿');
    assert.equal(DELIVERY_STATUS_META.not_sent.label, '待寄送');
    // 綁語意 token 而不是色階名：這裡要釘住的是「寄送失敗走 danger 這個語意」，
    // 至於 danger 今天是哪個紅，本來就該能換。
    assert.match(DELIVERY_STATUS_META.failed.class, /danger/);
    assert.equal(getAvailabilityStatusMeta(true).label, '使用中');
    assert.equal(getAvailabilityStatusMeta(false).label, '已停用');
  });
});

describe('records list marks', () => {
  const styleOf = (record) => `${reportMark(record).style}:${reportMark(record).label}`;
  it('merges report and delivery state into one mark, filled only when someone must act', () => {
    assert.equal(styleOf({ status: 'draft' }), 'dot:草稿');
    assert.equal(styleOf({ status: 'finalized', deliveryStatus: 'not_sent' }), 'pill:待寄送');
    assert.equal(styleOf({ status: 'finalized', deliveryStatus: 'failed' }), 'pill:寄送失敗');
    assert.equal(styleOf({ status: 'finalized', deliveryStatus: 'uncertain' }), 'pill:結果待確認');
    assert.equal(styleOf({ status: 'finalized', deliveryStatus: 'sending' }), 'dot:寄送中');
    assert.equal(styleOf({ status: 'finalized', deliveryStatus: 'sent' }), 'check:已寄出');
  });

  it('treats an unsent report the desk marked as not to be sent as settled, and notes it elsewhere', () => {
    assert.equal(styleOf({ status: 'finalized', deliveryStatus: 'not_sent', deskNoVisitRecord: true }), 'dot:不寄就診紀錄');
    assert.equal(reportMarkNote({ status: 'finalized', deliveryStatus: 'not_sent', deskNoVisitRecord: true }), '');
    assert.equal(reportMarkNote({ status: 'draft', deskNoVisitRecord: true }), '不寄就診紀錄');
    assert.equal(reportMarkNote({ status: 'draft' }), '');
  });

  it('fills the desk mark only while the ball is with the desk', () => {
    assert.equal(deskMark({ deskStatus: 'desk_pending' }).style, 'pill');
    assert.equal(deskMark({ deskStatus: 'reopen_requested' }).style, 'pill');
    assert.equal(deskMark({ deskStatus: 'with_doctor' }).style, 'text');
    assert.deepEqual([deskMark({ deskStatus: 'desk_done' }).style, deskMark({ deskStatus: 'desk_done' }).label], ['check', '已完成']);
    assert.equal(deskMark({ deskStatus: '' }), null);
  });
});

describe('填寫頁固定列的櫃台狀態', () => {
  const labels = (visitLink) => visitDeskMarks(visitLink).map((mark) => `${mark.style}:${mark.label}`);
  it('球在櫃台手上、或不寄就診紀錄才是膠囊；不寄取代櫃台已完成', () => {
    assert.deepEqual(labels({ deskStatus: 'with_doctor' }), ['text:還沒送交櫃台']);
    assert.deepEqual(labels({ deskStatus: 'desk_pending' }), ['pill:櫃台還沒處理完']);
    assert.deepEqual(labels({ deskStatus: 'desk_done' }), ['check:櫃台已完成']);
    assert.deepEqual(labels({ deskStatus: 'desk_done', noVisitRecord: true }), ['pill:不寄就診紀錄']);
    assert.deepEqual(labels({ deskStatus: 'reopen_requested', noVisitRecord: true }), ['pill:待核准修改', 'pill:不寄就診紀錄']);
    assert.deepEqual(labels(null), []);
  });
});
