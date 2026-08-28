import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { itemHasAnswer, validateFinalRecord } from './recordValidation.js';

// 這裡測的是「報告能不能結案」。結案之後就會產 PDF 寄給飼主，而且鎖定不能再改，
// 所以每一條規則漏判的代價都是把不完整的醫療報告送出門。
//
// 測試刻意都用「組出一份 sections」的方式描述情境，而不是直接呼叫內部小函式：
// 這樣重構內部結構時測試不會跟著碎掉，它保護的是對外的判斷結果。

const section = (...items) => [{ key: 's1', title: '區塊', items }];

// 一份有內容的報告，各個測試在這上面做單點變動。
const validSections = () =>
  section(
    { key: 'visitDate', label: '看診日期', type: 'date', role: 'visitDate', value: '2026-08-20' },
    { key: 'vet', label: '獸醫師', type: 'text', role: 'vet', value: '王醫師' },
    { key: 'weight', label: '體重', type: 'measurement', value: '4.2' },
    { key: 'conclusion', label: '結論', type: 'textarea', role: 'conclusion', value: '整體健康狀況良好' }
  );

describe('validateFinalRecord', () => {
  it('完整的報告沒有缺漏', () => {
    assert.deepEqual(validateFinalRecord(validSections()), []);
  });

  it('所有欄位都設為非必填時，空白報告可以結案', () => {
    assert.deepEqual(validateFinalRecord(section(
      { key: 'visitDate', label: '看診日期', type: 'date', role: 'visitDate', required: false, value: '' },
      { key: 'weight', label: '體重', type: 'measurement', required: false, value: '' },
      { key: 'conclusion', label: '結論', type: 'textarea', role: 'conclusion', required: false, value: '' },
      { key: 'plan', label: '照護建議', type: 'textarea', role: 'treatmentPlan', required: false, value: '' }
    )), []);
  });

  it('必填項目沒作答會列出該項名稱', () => {
    const sections = validSections();
    sections[0].items.push({ key: 'temp', label: '體溫', type: 'measurement', required: true, value: '' });
    assert.ok(validateFinalRecord(sections).includes('體溫'));
  });

  it('必填項目有作答就不會被列出', () => {
    const sections = validSections();
    sections[0].items.push({ key: 'temp', label: '體溫', type: 'measurement', required: true, value: '38.5' });
    assert.deepEqual(validateFinalRecord(sections), []);
  });

  describe('結論與照護建議', () => {
    it('不再有寫死的擇一必填規則', () => {
      assert.deepEqual(validateFinalRecord(section(
        { key: 'conclusion', label: '結論', type: 'textarea', role: 'conclusion', required: false, value: '' },
        { key: 'plan', label: '照護建議', type: 'textarea', role: 'treatmentPlan', required: false, value: '' }
      )), []);
    });

    it('各欄位可分別設定為必填', () => {
      const missing = validateFinalRecord(section(
        { key: 'conclusion', label: '結論', type: 'textarea', role: 'conclusion', required: true, value: '   ' },
        { key: 'plan', label: '照護建議', type: 'textarea', role: 'treatmentPlan', required: false, value: '' }
      ));
      assert.deepEqual(missing, ['結論']);
    });
  });

  describe('異常項目不強制寫說明', () => {
    it('標記異常但沒寫備註也能放行——備註是給獸醫參考用，不是結案門檻', () => {
      const sections = validSections();
      sections[0].items.push({ key: 'skin', label: '皮膚', type: 'finding', status: 'abnormal', note: '' });
      assert.deepEqual(validateFinalRecord(sections), []);
    });

    it('檢驗異常同樣不強制備註', () => {
      const sections = validSections();
      sections[0].items.push({ key: 'alt', label: 'ALT', type: 'lab', status: 'abnormal', value: '120', note: '' });
      assert.deepEqual(validateFinalRecord(sections), []);
    });
  });

  describe('檢驗數值格式', () => {
    it('數值型項目填非數字不會被擋——只有 numeric 開著才自動判讀正常/異常，格式本身不強制', () => {
      const sections = validSections();
      sections[0].items.push({ key: 'alt', label: 'ALT', type: 'lab', status: 'normal', value: '偏高' });
      assert.deepEqual(validateFinalRecord(sections), []);
    });

    it('numeric 為 false 的項目本來就是文字結果，同樣不擋', () => {
      // 有些檢驗結果本來就是文字（例如「陰性」），範本可以把它標成非數值。
      const sections = validSections();
      sections[0].items.push({ key: 'fiv', label: 'FIV', type: 'lab', status: 'normal', value: '陰性', numeric: false });
      assert.deepEqual(validateFinalRecord(sections), []);
    });
  });
});

// itemHasAnswer 是必填檢查的判準，所以逐型別釘住。
describe('itemHasAnswer', () => {
  it('理學檢查看的是有沒有標記過，不是有沒有值', () => {
    assert.equal(itemHasAnswer({ type: 'finding', status: 'not_checked' }), false);
    assert.equal(itemHasAnswer({ type: 'finding', status: 'normal' }), true);
    assert.equal(itemHasAnswer({ type: 'finding', status: 'abnormal' }), true);
  });

  it('檢驗項目標記過或填了數值都算有作答', () => {
    assert.equal(itemHasAnswer({ type: 'lab', status: 'not_checked', value: '' }), false);
    assert.equal(itemHasAnswer({ type: 'lab', status: 'normal', value: '' }), true, '按了正常但沒填數值也算');
    assert.equal(itemHasAnswer({ type: 'lab', status: 'not_checked', value: '42' }), true, '沒標記但填了數值也算');
  });

  it('一般欄位看值，空字串與空白都不算', () => {
    assert.equal(itemHasAnswer({ type: 'text', value: '' }), false);
    assert.equal(itemHasAnswer({ type: 'text', value: '   ' }), false);
    assert.equal(itemHasAnswer({ type: 'text', value: null }), false);
    assert.equal(itemHasAnswer({ type: 'text', value: undefined }), false);
    assert.equal(itemHasAnswer({ type: 'text', value: '正常' }), true);
  });

  it('數值 0 是有效作答', () => {
    // 這種地方最容易寫成 falsy 判斷。體重 0 不合理，但心絲蟲數量 0 是正常結果。
    assert.equal(itemHasAnswer({ type: 'number', value: 0 }), true);
  });
});
