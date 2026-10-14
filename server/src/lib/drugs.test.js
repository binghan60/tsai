import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDrugName, drugNameKey, drugNameLength, parseDrugNames } from './drugs.js';

describe('drugs', () => {
  it('整理名稱：去掉頭尾空白、換行與連續空白', () => {
    assert.equal(cleanDrugName('  Metoclopramide\t（胃排空劑）\n'), 'Metoclopramide （胃排空劑）');
    assert.equal(cleanDrugName(null), '');
  });

  it('重複判斷不分大小寫與空白多寡', () => {
    assert.equal(drugNameKey('Metoclopramide  0.5mg'), drugNameKey(' metoclopramide 0.5MG '));
  });

  it('格式標記：整理成標準形式，重複與字數都看純文字', () => {
    assert.equal(cleanDrugName('[red]Famotidine[/red] 0.5mg'), '[red]Famotidine[/red] 0.5mg');
    assert.equal(drugNameKey('**Famotidine** 0.5 mg'), drugNameKey('famotidine 0.5 MG'));
    assert.equal(drugNameLength('[red]abc[/red]'), 3);
    assert.deepEqual(parseDrugNames(['**A**', 'a']), ['**A**']);
  });

  it('批次貼上：一行一筆、略過空行與重複', () => {
    assert.deepEqual(parseDrugNames('Metoclopramide\n\n  famotidine \r\nFAMOTIDINE\n胃藥'), ['Metoclopramide', 'famotidine', '胃藥']);
    assert.deepEqual(parseDrugNames(['A', ' a ', 'B']), ['A', 'B']);
  });
});
