import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { composeReportSections } from './reportSections.js';

// 這裡測的是「範本結構 + 報告作答 → 報告頁要畫的東西」。
//
// 結案時這份結果會被凍成 record.sections，之後產 PDF、寄給飼主、日後回頭查病歷，
// 看到的都是它。組錯的後果不是畫面壞掉，而是病歷上少了一項紀錄、或某個數字接到別的欄位。
//
// 測試一律從「一份範本 + 一份報告」描述情境，不直接戳內部小函式：
// 保護的是組出來的結果，內部怎麼拆不影響這些斷言。

const template = (...sections) => ({ sections });
const section = (key, title, items, extra = {}) => ({ key, title, items, ...extra });
const item = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });

// 報告只會用到這幾個欄位，其餘留空即可。
const record = (fields = {}) => ({
  examinationFindings: [],
  labFindings: [],
  measurementAssessments: [],
  customValues: {},
  ...fields,
});

const itemsOf = (sections) => sections.flatMap((entry) => entry.items);
const find = (sections, key) => itemsOf(sections).find((entry) => entry.key === key);

describe('composeReportSections：結構', () => {
  it('依 order 排序，停用的區塊與項目都不出現', () => {
    const sections = composeReportSections(
      record(),
      template(
        section('b', '後面', [item('i2', '項目二')], { order: 2 }),
        section('a', '前面', [item('i1', '項目一'), item('hidden', '停用項目', 'text', { enabled: false })], { order: 1 }),
        section('gone', '停用區塊', [item('i3', '項目三')], { order: 0, enabled: false })
      )
    );

    assert.deepEqual(sections.map((entry) => entry.key), ['a', 'b']);
    assert.deepEqual(sections[0].items.map((entry) => entry.key), ['i1']);
  });

  it('報告上的標題優先用 reportTitle，沒填才沿用 title', () => {
    const sections = composeReportSections(
      record(),
      template(
        section('a', '基本資料', [], { reportTitle: '主訴與病史' }),
        section('b', '結論', [])
      )
    );

    assert.deepEqual(sections.map((entry) => entry.title), ['主訴與病史', '結論']);
  });

  // 結案驗證是走訪組合後的 sections，必填旗標沒帶過來的話，必填欄位會全部形同虛設。
  it('必填旗標會跟著帶進來', () => {
    const sections = composeReportSections(
      record(),
      template(section('a', '區塊', [item('i1', '必填項目', 'text', { required: true }), item('i2', '一般項目')]))
    );

    assert.equal(find(sections, 'i1').required, true);
    assert.equal(find(sections, 'i2').required, false);
  });
});

describe('composeReportSections：作答從哪裡讀', () => {
  it('型別與具名欄位相符時讀具名欄位', () => {
    const sections = composeReportSections(
      record({ conclusion: '整體健康狀況良好' }),
      template(section('a', '結論', [item('conclusion', '結論', 'textarea')]))
    );

    assert.equal(find(sections, 'conclusion').value, '整體健康狀況良好');
  });

  it('自訂項目讀 customValues，物件與 Map 都要能讀', () => {
    const asObject = composeReportSections(
      record({ customValues: { custom_ab12cd: '自訂欄位的內容' } }),
      template(section('a', '區塊', [item('custom_ab12cd', '自訂欄位')]))
    );
    assert.equal(find(asObject, 'custom_ab12cd').value, '自訂欄位的內容');

    // 從 Mongoose 文件直接拿到的 customValues 是 Map，不是普通物件。
    const asMap = composeReportSections(
      record({ customValues: new Map([['custom_ab12cd', '自訂欄位的內容']]) }),
      template(section('a', '區塊', [item('custom_ab12cd', '自訂欄位')]))
    );
    assert.equal(find(asMap, 'custom_ab12cd').value, '自訂欄位的內容');
  });

  // 讀哪裡由 storageFor 決定，跟寫入端同一套判斷。不能用「具名欄位優先」——
  // 項目改過型別後具名欄位還留著舊值，報告會一直顯示改型別之前的內容。
  it('項目改過型別後，讀的是新的落點而不是具名欄位的殘值', () => {
    const sections = composeReportSections(
      record({ temperatureC: 38.5, customValues: { temperatureC: '微燒' } }),
      template(section('a', '基本量測', [item('temperatureC', '體溫', 'text')]))
    );

    assert.equal(find(sections, 'temperatureC').value, '微燒');
  });

  it('沒作答時一般欄位是空字串，複選是空陣列', () => {
    const sections = composeReportSections(
      record(),
      template(section('a', '區塊', [item('i1', '文字'), item('custom_multi', '複選', 'checkbox')]))
    );

    assert.equal(find(sections, 'i1').value, '');
    assert.deepEqual(find(sections, 'custom_multi').value, []);
  });

  it('理學檢查取狀態與備註', () => {
    const sections = composeReportSections(
      record({ examinationFindings: [{ key: 'oral', label: '口腔', status: 'abnormal', note: '輕微牙結石' }] }),
      template(section('a', '理學檢查', [item('oral', '口腔', 'finding')], { presentation: 'findings' }))
    );

    const composed = find(sections, 'oral');
    assert.equal(composed.status, 'abnormal');
    assert.equal(composed.note, '輕微牙結石');
  });

  it('沒填過的理學檢查是未檢查，不是空白', () => {
    const sections = composeReportSections(
      record(),
      template(section('a', '理學檢查', [item('oral', '口腔', 'finding')], { presentation: 'findings' }))
    );

    assert.equal(find(sections, 'oral').status, 'not_checked');
  });

  it('檢驗項目取數值、狀態與參考範圍，單位以作答為準', () => {
    const sections = composeReportSections(
      record({
        labFindings: [{
          key: 'bun', label: 'BUN', status: 'normal', statusSource: 'auto',
          value: '22', unit: 'mg/dL', referenceMin: 16, referenceMax: 36, note: '',
        }],
      }),
      template(section('a', '檢驗', [item('bun', 'BUN', 'lab', { unit: '舊單位' })], { presentation: 'table' }))
    );

    const composed = find(sections, 'bun');
    assert.equal(composed.value, '22');
    assert.equal(composed.status, 'normal');
    assert.equal(composed.statusSource, 'auto');
    assert.equal(composed.unit, 'mg/dL');
    assert.deepEqual([composed.referenceMin, composed.referenceMax], [16, 36]);
  });

  it('量測值的數字來自具名欄位、判讀來自 measurementAssessments', () => {
    const sections = composeReportSections(
      record({
        weightKg: 4.2,
        measurementAssessments: [{ key: 'weightKg', label: '體重', status: 'normal', statusSource: 'auto', unit: 'kg', referenceMin: 3, referenceMax: 6 }],
      }),
      template(section('a', '基本量測', [item('weightKg', '體重', 'measurement')], { presentation: 'grid' }))
    );

    const composed = find(sections, 'weightKg');
    assert.equal(composed.value, 4.2);
    assert.equal(composed.status, 'normal');
    assert.equal(composed.unit, 'kg');
  });
});

// 使用者從範本刪掉某個項目後，已經記錄過該項目的報告不能讓資料憑空消失——
// 病歷必須完整保留當時記錄的內容。
describe('composeReportSections：範本已刪除的項目（孤兒）', () => {
  it('補在最後一個同型別的區塊尾端', () => {
    const sections = composeReportSections(
      record({
        examinationFindings: [
          { key: 'oral', label: '口腔', status: 'normal', note: '' },
          { key: 'removed', label: '已刪除的檢查', status: 'abnormal', note: '當時記下的異常' },
        ],
      }),
      template(
        section('a', '理學檢查', [item('oral', '口腔', 'finding')], { presentation: 'findings' }),
        section('b', '結論', [item('conclusion', '結論', 'textarea')])
      )
    );

    assert.deepEqual(sections[0].items.map((entry) => entry.key), ['oral', 'removed']);
    assert.equal(find(sections, 'removed').note, '當時記下的異常');
  });

  it('沒有同型別的區塊可收容時另開「其他紀錄」', () => {
    const sections = composeReportSections(
      record({ examinationFindings: [{ key: 'removed', label: '已刪除的檢查', status: 'normal', note: '' }] }),
      template(section('a', '結論', [item('conclusion', '結論', 'textarea')]))
    );

    const collector = sections.at(-1);
    assert.equal(collector.key, 'removed_items');
    assert.equal(collector.presentation, 'findings');
    assert.deepEqual(collector.items.map((entry) => entry.key), ['removed']);
  });

  it('收容區塊混到檢驗項目時改用表格版式', () => {
    const sections = composeReportSections(
      record({
        examinationFindings: [{ key: 'removed_finding', label: '已刪除的檢查', status: 'normal', note: '' }],
        labFindings: [{ key: 'removed_lab', label: '已刪除的檢驗', status: 'normal', value: '12', note: '' }],
      }),
      template(section('a', '結論', [item('conclusion', '結論', 'textarea')]))
    );

    assert.equal(sections.at(-1).presentation, 'table');
  });

  // labFindingSchema 沒有存 numeric，範本又已經刪掉這個項目，只能從記下來的值回推。
  // 一律當數值型會讓「少量結晶」這類文字結果永遠卡在結案驗證，而孤兒項目在表單上
  // 已經改不到了，使用者無從補救。
  it('檢驗孤兒的 numeric 從記下來的值回推', () => {
    const compose = (value) => composeReportSections(
      record({ labFindings: [{ key: 'removed_lab', label: '已刪除的檢驗', status: 'normal', value, note: '' }] }),
      template(section('a', '結論', [item('conclusion', '結論', 'textarea')]))
    );

    assert.equal(find(compose('12.5'), 'removed_lab').numeric, true);
    assert.equal(find(compose('少量結晶'), 'removed_lab').numeric, false);
    // 沒有值就無從判斷，當數值型不會擋到任何人
    assert.equal(find(compose(''), 'removed_lab').numeric, true);
  });

  it('範本裡還在的項目不會被當成孤兒重複列出', () => {
    const sections = composeReportSections(
      record({ examinationFindings: [{ key: 'oral', label: '口腔', status: 'normal', note: '' }] }),
      template(section('a', '理學檢查', [item('oral', '口腔', 'finding')], { presentation: 'findings' }))
    );

    assert.equal(itemsOf(sections).filter((entry) => entry.key === 'oral').length, 1);
    assert.ok(!sections.some((entry) => entry.key === 'removed_items'));
  });
});

describe('composeReportSections：範本不存在', () => {
  // 範本被刪除時 templateForRecord() 會回 null。已結案報告有自己的快照走不到這裡，
  // 但草稿會 —— 至少不能整個爆掉。
  it('範本是 null 時回空陣列，記錄過的內容仍然收得回來', () => {
    assert.deepEqual(composeReportSections(record(), null), []);

    const sections = composeReportSections(
      record({ examinationFindings: [{ key: 'oral', label: '口腔', status: 'normal', note: '' }] }),
      null
    );
    assert.equal(sections.at(-1).key, 'removed_items');
  });
});
