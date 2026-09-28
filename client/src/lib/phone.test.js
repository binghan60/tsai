import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkMobilePhone, MOBILE_PHONE_ERROR, normalizeMobilePhone } from '../../../shared/phone.js';

describe('checkMobilePhone', () => {
  it('手機格式整理後照收，空值不算錯', () => {
    assert.deepEqual(checkMobilePhone('0912-345-678'), { phone: '0912345678', error: '' });
    assert.deepEqual(checkMobilePhone('  '), { phone: '', error: '' });
  });

  it('不是手機就報錯，除非跟原本存的值一樣（舊資料的市話）', () => {
    assert.deepEqual(checkMobilePhone('03-561-9595'), { phone: '03-561-9595', error: MOBILE_PHONE_ERROR });
    assert.deepEqual(checkMobilePhone('03-561-9595', '03-561-9595'), { phone: '03-561-9595', error: '' });
    assert.deepEqual(checkMobilePhone('03-561-9596', '03-561-9595'), { phone: '03-561-9596', error: MOBILE_PHONE_ERROR });
  });
});

describe('normalizeMobilePhone', () => {
  it('整理常見的手機寫法成 10 碼數字', () => {
    assert.equal(normalizeMobilePhone('0912345678'), '0912345678');
    assert.equal(normalizeMobilePhone('0912-345-678'), '0912345678');
    assert.equal(normalizeMobilePhone(' 0912 345 678 '), '0912345678');
    assert.equal(normalizeMobilePhone('+886 912 345 678'), '0912345678');
    assert.equal(normalizeMobilePhone('+886-0912-345-678'), '0912345678');
    assert.equal(normalizeMobilePhone('886912345678'), '0912345678');
  });

  it('不是手機號碼就回傳空字串', () => {
    assert.equal(normalizeMobilePhone(''), '');
    assert.equal(normalizeMobilePhone(null), '');
    assert.equal(normalizeMobilePhone('091234567'), '');
    assert.equal(normalizeMobilePhone('09123456789'), '');
    assert.equal(normalizeMobilePhone('03-561-9595'), '');
    assert.equal(normalizeMobilePhone('0812345678'), '');
    assert.equal(normalizeMobilePhone('0912abc678'), '');
  });
});
