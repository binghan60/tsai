import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { anchorFor, collectPreviewIssues, createIsFilled } from './recordFormValidation.js';

// 這些案例是拿來釘住「前端判準」的，而它必須跟 server/src/lib/recordValidation.js
// 保持同一套語意。改動任何一邊時，兩邊的測試都要一起看：判準分岔的症狀是
// 使用者在前端通過驗證、按下結案才被後端 422 擋下來。

const messages = (issues) => issues.map((issue) => issue.message);

function section(items, id = 'section-1') {
  return [{ id, items }];
}

// 一般欄位的取值來源；測試裡直接把值掛在項目上，省掉一層假的 record 物件。
const getValue = (item) => item.value;

describe('createIsFilled', () => {
  it('finding 只看有沒有標記過，不看 value', () => {
    const filled = createIsFilled({ getValue, findings: [{ key: 'skin', status: 'normal' }] });
    assert.equal(filled({ type: 'finding', key: 'skin' }), true);
  });

  it('finding 停在 not_checked 就是沒作答', () => {
    const filled = createIsFilled({ getValue, findings: [{ key: 'skin', status: 'not_checked' }] });
    assert.equal(filled({ type: 'finding', key: 'skin' }), false);
  });

  it('lab 標記過或填了數值都算作答', () => {
    const marked = createIsFilled({ getValue, labFindings: [{ key: 'alt', status: 'normal', value: '' }] });
    assert.equal(marked({ type: 'lab', key: 'alt' }), true);

    const valued = createIsFilled({ getValue, labFindings: [{ key: 'alt', status: 'not_checked', value: '42' }] });
    assert.equal(valued({ type: 'lab', key: 'alt' }), true);

    const empty = createIsFilled({ getValue, labFindings: [{ key: 'alt', status: 'not_checked', value: '  ' }] });
    assert.equal(empty({ type: 'lab', key: 'alt' }), false);
  });

  it('一般欄位只有空白字元不算作答', () => {
    const filled = createIsFilled({ getValue });
    assert.equal(filled({ type: 'text', key: 'note', value: '   ' }), false);
    assert.equal(filled({ type: 'text', key: 'note', value: '正常' }), true);
  });
});

describe('anchorFor', () => {
  it('依型別組出對應版式元件的 DOM id', () => {
    assert.equal(anchorFor({ type: 'finding', key: 'skin' }), 'record-exam-row-skin');
    assert.equal(anchorFor({ type: 'lab', key: 'alt' }), 'record-lab-row-alt');
    assert.equal(anchorFor({ type: 'text', key: 'note' }), 'record-note');
  });

  it('沒有項目時退回區塊本身', () => {
    assert.equal(anchorFor(null, 'section-1'), 'section-1');
  });
});

describe('collectPreviewIssues 必填', () => {
  it('必填沒作答就報錯，並指到該欄位', () => {
    const issues = collectPreviewIssues({
      sections: section([{ key: 'weight', label: '體重', type: 'measurement', required: true, value: '' }]),
      getValue,
    });
    assert.ok(messages(issues).includes('請填寫體重'));
    assert.equal(issues[0].targetId, 'record-weight');
  });

  it('非必填留白不報錯', () => {
    const issues = collectPreviewIssues({
      sections: section([
        { key: 'weight', label: '體重', type: 'measurement', value: '5' },
        { key: 'note', label: '備註', type: 'text', value: '' },
      ]),
      getValue,
    });
    assert.deepEqual(messages(issues), []);
  });
});

describe('collectPreviewIssues 臨床內容', () => {
  it('只填了看診日與獸醫師不算有臨床內容', () => {
    const issues = collectPreviewIssues({
      sections: section([
        { key: 'visitDate', role: 'visitDate', label: '看診日', type: 'date', value: '2026-08-25' },
        { key: 'vet', role: 'vet', label: '獸醫師', type: 'text', value: '王醫師' },
      ]),
      getValue,
    });
    assert.ok(messages(issues).includes('請至少填寫一個區塊的檢查內容'));
  });

  it('任何一個非行政欄位有作答就通過', () => {
    const issues = collectPreviewIssues({
      sections: section([
        { key: 'visitDate', role: 'visitDate', label: '看診日', type: 'date', value: '2026-08-25' },
        { key: 'weight', label: '體重', type: 'measurement', value: '5.2' },
      ]),
      getValue,
    });
    assert.deepEqual(messages(issues), []);
  });

  it('只標記了理學檢查也算有臨床內容', () => {
    const issues = collectPreviewIssues({
      sections: section([{ key: 'skin', label: '皮膚', type: 'finding' }]),
      getValue,
      findings: [{ key: 'skin', label: '皮膚', status: 'normal' }],
    });
    assert.deepEqual(messages(issues), []);
  });
});

describe('collectPreviewIssues 結論與照護建議', () => {
  const withBoth = (conclusionValue, planValue) =>
    collectPreviewIssues({
      sections: section([
        { key: 'weight', label: '體重', type: 'measurement', value: '5' },
        { key: 'conclusion', role: 'conclusion', label: '結論', type: 'prose', value: conclusionValue },
        { key: 'plan', role: 'treatmentPlan', label: '照護建議', type: 'prose', value: planValue },
      ]),
      getValue,
    });

  it('兩個都空就報錯，訊息把兩個標籤串起來', () => {
    assert.ok(messages(withBoth('', '')).includes('請填寫結論或照護建議'));
  });

  it('任一個有值就通過', () => {
    assert.deepEqual(messages(withBoth('一切正常', '')), []);
    assert.deepEqual(messages(withBoth('', '兩週後回診')), []);
  });

  it('兩個欄位都不在範本裡就不檢查', () => {
    const issues = collectPreviewIssues({
      sections: section([{ key: 'weight', label: '體重', type: 'measurement', value: '5' }]),
      getValue,
    });
    assert.deepEqual(messages(issues), []);
  });
});

describe('collectPreviewIssues 數值範圍', () => {
  const bcs = (value) =>
    collectPreviewIssues({
      sections: section([{ key: 'bcs', label: '體態評分', type: 'number', min: 1, max: 9, value }]),
      getValue,
    });

  it('超出範本設定的上下限就報錯', () => {
    assert.ok(messages(bcs('0')).includes('體態評分不可小於 1'));
    assert.ok(messages(bcs('10')).includes('體態評分不可大於 9'));
  });

  it('範圍內不報錯', () => {
    assert.deepEqual(messages(bcs('5')), []);
  });

  it('填了非數字只報「必須是數字」，不再報範圍', () => {
    assert.deepEqual(messages(bcs('偏瘦')), ['體態評分必須是數字']);
  });

  it('留白的數值欄位不檢查範圍', () => {
    const issues = collectPreviewIssues({
      sections: section([
        { key: 'weight', label: '體重', type: 'measurement', value: '5' },
        { key: 'bcs', label: '體態評分', type: 'number', min: 1, max: 9, value: '' },
      ]),
      getValue,
    });
    assert.deepEqual(messages(issues), []);
  });
});

describe('collectPreviewIssues 異常說明', () => {
  it('標成異常卻沒寫說明就報錯，並把焦點指到說明欄', () => {
    const issues = collectPreviewIssues({
      sections: section([{ key: 'skin', label: '皮膚', type: 'finding' }]),
      getValue,
      findings: [{ key: 'skin', label: '皮膚', status: 'abnormal', note: '  ' }],
    });
    assert.ok(messages(issues).includes('請補充理學檢查異常說明：皮膚'));
    const issue = issues.find((entry) => entry.message.includes('皮膚'));
    assert.equal(issue.targetId, 'record-exam-row-skin');
    assert.equal(issue.focusId, 'record-exam-note-skin');
  });

  it('檢驗異常走自己的訊息與錨點', () => {
    const issues = collectPreviewIssues({
      sections: section([{ key: 'alt', label: 'ALT', type: 'lab' }]),
      getValue,
      labFindings: [{ key: 'alt', label: 'ALT', status: 'abnormal', value: '120', note: '' }],
    });
    const issue = issues.find((entry) => entry.message.includes('ALT'));
    assert.equal(issue.message, '請補充檢驗異常說明：ALT');
    assert.equal(issue.focusId, 'record-lab-note-alt');
  });

  it('寫了說明就通過', () => {
    const issues = collectPreviewIssues({
      sections: section([{ key: 'skin', label: '皮膚', type: 'finding' }]),
      getValue,
      findings: [{ key: 'skin', label: '皮膚', status: 'abnormal', note: '左後肢紅疹' }],
    });
    assert.deepEqual(messages(issues), []);
  });
});
