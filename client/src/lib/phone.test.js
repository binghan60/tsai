import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeMobilePhone } from '../../../shared/phone.js';

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
