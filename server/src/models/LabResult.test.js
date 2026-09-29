import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import LabResult from './LabResult.js';
import { parseIdexxResult } from '../lib/idexxResult.js';
import { labResultContent } from '../lib/labResultImport.js';

function fixture(name) {
  return parseIdexxResult(readFileSync(new URL(`../../test/fixtures/idexx/${name}`, import.meta.url)));
}

describe('LabResult schema', () => {
  it('解析結果原樣收得下，IDEXX 的病患編號不會被 Mongoose 的 id 吃掉', () => {
    const doc = new LabResult({ ...labResultContent(fixture('catalyst-one.xml')), rawXml: '<message/>' });
    assert.equal(doc.validateSync(), undefined);
    assert.equal(doc.patient.id, '000001');
    assert.equal(doc.client.id, '000001');
    assert.equal(doc.patient.weight, null);
    assert.equal(doc.assays[0].referenceMax, 143);
    assert.equal(doc.petId, null);
  });

  it('文字結果與空的參考範圍都存得下', () => {
    const doc = new LabResult({ ...labResultContent(fixture('snap-triple.xml')), rawXml: '<message/>' });
    assert.equal(doc.validateSync(), undefined);
    assert.equal(doc.assays[0].value, 'Positive');
    assert.equal(doc.assays[0].referenceMin, null);
  });

  it('原始檔是必填，沒有就不給存', () => {
    const doc = new LabResult(labResultContent(fixture('snap-triple.xml')));
    assert.ok(doc.validateSync()?.errors.rawXml);
  });
});
