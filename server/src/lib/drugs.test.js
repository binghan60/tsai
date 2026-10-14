import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDrugName, drugNameKey, parseDrugNames } from './drugs.js';

describe('drugs', () => {
  it('整理名稱：去掉頭尾空白、換行與連續空白', () => {
    assert.equal(cleanDrugName('  Metoclopramide\t（胃排空劑）\n'), 'Metoclopramide （胃排空劑）');
    assert.equal(cleanDrugName(null), '');
  });

  it('重複判斷不分大小寫與空白多寡', () => {
    assert.equal(drugNameKey('Metoclopramide  0.5mg'), drugNameKey(' metoclopramide 0.5MG '));
  });

  it('批次貼上：一行一筆、略過空行與重複', () => {
    assert.deepEqual(parseDrugNames('Metoclopramide\n\n  famotidine \r\nFAMOTIDINE\n胃藥'), ['Metoclopramide', 'famotidine', '胃藥']);
    assert.deepEqual(parseDrugNames(['A', ' a ', 'B']), ['A', 'B']);
  });
});
