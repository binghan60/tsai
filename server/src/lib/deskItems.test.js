import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDeskItems, deskItemsText, sortDeskItems, toggleDeskItem } from '../../../shared/deskItems.js';

test('處理事項：照定義順序、去重、丟掉不認得的', () => {
  assert.deepEqual(sortDeskItems(['consent_signed', 'receipt', 'receipt', 'nope', 'image_usb']), ['image_usb', 'receipt', 'consent_signed']);
  assert.deepEqual(sortDeskItems(undefined), []);
});

test('處理事項：驗證——格式、未知項目、互斥組選兩個', () => {
  assert.deepEqual(checkDeskItems(['prescription_given', 'itemized_bill']), { items: ['itemized_bill', 'prescription_given'] });
  // 報告寄出與否由系統依報告寄送狀態判斷，不是勾選項目。
  assert.match(checkDeskItems(['report_sent']).error, /不在清單/);
  assert.deepEqual(checkDeskItems([]), { items: [] });
  assert.match(checkDeskItems('receipt').error, /格式不正確/);
  assert.match(checkDeskItems(['nope']).error, /不在清單/);
  assert.match(checkDeskItems(['receipt', 'receipt_no_stamp']).error, /只能選一個/);
  assert.match(checkDeskItems(['image_usb', 'no_image']).error, /只能選一個/);
  // 同一項重複不算選兩個。
  assert.deepEqual(checkDeskItems(['receipt', 'receipt']), { items: ['receipt'] });
});

test('處理事項：互斥組勾新的會取消同組原本那個，其他組不受影響', () => {
  assert.deepEqual(toggleDeskItem(['receipt', 'itemized_bill'], 'receipt_no_stamp', true), ['receipt_no_stamp', 'itemized_bill']);
  assert.deepEqual(toggleDeskItem(['image_usb'], 'no_image', true), ['no_image']);
  assert.deepEqual(toggleDeskItem(['itemized_bill'], 'prescription_given', true), ['itemized_bill', 'prescription_given']);
  assert.deepEqual(toggleDeskItem(['receipt', 'itemized_bill'], 'receipt', false), ['itemized_bill']);
});

test('處理事項：日誌文字用「、」接起來', () => {
  assert.equal(deskItemsText(['prescription_given', 'receipt']), '已開收據、已給藥單');
  assert.equal(deskItemsText([]), '');
  assert.equal(deskItemsText(undefined), '');
});
