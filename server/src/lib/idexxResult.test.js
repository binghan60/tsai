import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IdexxParseError, parseIdexxDateTime, parseIdexxResult } from './idexxResult.js';
import { labFlag } from '../../../shared/labValues.js';

// 範例檔是 IDEXX InterLink 真實輸出的檔案（test/fixtures/idexx），不是照文件手寫的——
// 文件跟實際輸出對不上的地方（多出來的文字、兩種 µ、文件沒列的儀器）正是這裡要釘住的。
function fixture(name) {
  return readFileSync(new URL(`../../test/fixtures/idexx/${name}`, import.meta.url));
}

describe('parseIdexxResult：Catalyst One 生化', () => {
  const result = parseIdexxResult(fixture('catalyst-one.xml'));

  it('讀出儀器、檢驗識別碼與訊息類型', () => {
    assert.equal(result.instrument, 'Catalyst_One');
    assert.equal(result.diagnosticSetId, '20110909_103647_92');
    assert.equal(result.subType, 'New_Results');
    assert.equal(result.requisitionNumber, '1');
  });

  it('檢驗時間照台北時區換算', () => {
    // 09/09/2011 10:36:47.880 AM 台北 = 02:36:47.880Z。
    assert.equal(result.runAt.toISOString(), '2011-09-09T02:36:47.880Z');
  });

  it('貓咪與飼主資料，中文名字正確解碼', () => {
    assert.equal(result.patient.id, '000001');
    assert.equal(result.patient.name, '娜娜');
    assert.equal(result.patient.species, 'CANINE');
    assert.equal(result.patient.birthDate, '1991-01-01');
    assert.equal(result.client.firstName, '王小明');
  });

  it('體重 0 當成沒量', () => {
    assert.equal(result.patient.weight, null);
  });

  it('夾在 <assay_result> 裡的多餘文字不影響讀取', () => {
    assert.deepEqual(result.assays.map((assay) => assay.code), ['GLU', 'BUN', 'CREA', 'SDMA']);
    assert.deepEqual(result.assays[0], {
      code: 'GLU',
      value: '117',
      unit: 'mg/dL',
      referenceMin: 74,
      referenceMax: 143,
      criticalMin: 15,
      criticalMax: 700,
      qualifier: '=',
    });
  });

  it('µ（micro sign）統一成 μ', () => {
    assert.equal(result.assays.find((assay) => assay.code === 'SDMA').unit, 'μg/dL');
  });

  it('欄位名稱跟看診的 labValues 一致，可以直接套用偏高偏低判斷', () => {
    assert.equal(labFlag(result.assays[0]), '');
    assert.equal(labFlag({ ...result.assays[0], value: '150' }), '↑');
  });
});

describe('parseIdexxResult：Big5 編碼', () => {
  it('照 XML 宣告的編碼解碼，中文不會變亂碼', () => {
    const result = parseIdexxResult(fixture('catalyst-one-big5.xml'));
    assert.equal(result.patient.name, '娜娜');
    assert.equal(result.client.firstName, '王小明');
    assert.equal(result.assays.length, 4);
  });
});

describe('parseIdexxResult：SNAP 快篩（直接在 IDEXX 主機上做的檢驗）', () => {
  const result = parseIdexxResult(fixture('snap-triple.xml'));

  it('沒有從我們這邊開單，開單號與貓咪編號都是空的——之後要人工配對', () => {
    assert.equal(result.requisitionNumber, '');
    assert.equal(result.patient.id, '');
    assert.equal(result.patient.name, 'test2');
    assert.equal(result.patient.species, 'FELINE');
  });

  it('陽性／陰性是文字結果，沒有單位也沒有參考範圍', () => {
    assert.deepEqual(
      result.assays.map(({ code, value }) => [code, value]),
      [
        ['FeLV', 'Positive'],
        ['FIV', 'Negative'],
        ['HW', 'Positive'],
      ]
    );
    assert.equal(result.assays[0].unit, '');
    assert.equal(result.assays[0].referenceMin, null);
    assert.equal(labFlag(result.assays[0]), '');
  });

  it('下午的時間換算成 24 小時制', () => {
    // 05/16/2024 03:06:49.618 PM 台北 = 07:06:49.618Z。
    assert.equal(result.runAt.toISOString(), '2024-05-16T07:06:49.618Z');
  });
});

describe('parseIdexxResult：inVue Dx 血液形態', () => {
  const result = parseIdexxResult(fixture('invue-blood-morphology.xml'));

  it('文件沒列的儀器名稱照樣接收', () => {
    assert.equal(result.instrument, 'IDEXX_inVue_Dx');
    assert.equal(result.assays.length, 16);
  });

  it('數值與整句判讀都原樣保留', () => {
    const rbc = result.assays.find((assay) => assay.code === 'RBC_BLD');
    assert.equal(rbc.value, '5.00');
    assert.equal(rbc.unit, 'M/μL');
    const plt = result.assays.find((assay) => assay.code === 'PLT_EST');
    assert.equal(plt.value, '100-150 K/uL (Mildly decreased)');
    assert.equal(labFlag(plt), '');
  });

  it('儀器備註逐條保留', () => {
    assert.equal(result.notes.length, 5);
    assert.equal(result.notes[0], 'Agglutination and spherocytes were not detected.');
  });
});

describe('parseIdexxResult：inVue Dx 耳道細胞學', () => {
  const result = parseIdexxResult(fixture('invue-ear-cytology.xml'));

  it('結果被儀器壓掉時，判讀旗標是 -', () => {
    const yeast = result.assays.find((assay) => assay.code === 'YEA_RIGHT');
    assert.equal(yeast.qualifier, '-');
    assert.equal(yeast.value, '--.-- Result Suppressed. See below.');
  });

  it('左右耳各五項、備註四條', () => {
    assert.equal(result.assays.length, 10);
    assert.equal(result.notes.length, 4);
  });
});

describe('parseIdexxResult：讀不了的檔案要明確報錯', () => {
  function assertParseError(input, code) {
    assert.throws(
      () => parseIdexxResult(input),
      (error) => error instanceof IdexxParseError && error.code === code
    );
  }

  it('InterLink 還沒寫完的檔案（被截斷）', () => {
    const whole = fixture('catalyst-one.xml').toString('utf8');
    assertParseError(whole.slice(0, Math.floor(whole.length / 2)), 'malformed');
  });

  it('不是 XML', () => {
    assertParseError('hello', 'malformed');
  });

  it('IDEXX 主機回的開單訊息不是檢驗結果', () => {
    assertParseError(
      '<?xml version="1.0"?><message message_type="Work_Request" message_sub_type="Complete"><header/><body/></message>',
      'not_result'
    );
  });

  it('結果裡沒有任何項目', () => {
    assertParseError(
      '<?xml version="1.0"?><message message_type="Result"><body><result diagnostic_set_id="x" instrument="SNAP"><results/></result></body></message>',
      'invalid'
    );
  });
});

describe('parseIdexxDateTime', () => {
  it('午夜 12 點是 00 點、中午 12 點是 12 點', () => {
    assert.equal(parseIdexxDateTime('01/02/2026 12:05:00.000 AM').toISOString(), '2026-01-01T16:05:00.000Z');
    assert.equal(parseIdexxDateTime('01/02/2026 12:05:00.000 PM').toISOString(), '2026-01-02T04:05:00.000Z');
  });

  it('看不懂的日期回傳 null', () => {
    assert.equal(parseIdexxDateTime(''), null);
    assert.equal(parseIdexxDateTime('2026-01-02'), null);
    assert.equal(parseIdexxDateTime('13/02/2026 10:00:00 AM'), null);
    assert.equal(parseIdexxDateTime('01/02/2026 13:00:00 PM'), null);
  });
});
