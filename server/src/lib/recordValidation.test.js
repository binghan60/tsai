import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { itemHasAnswer, validateFinalRecord } from './recordValidation.js';

// 這裡測的是「報告能不能結案」。結案之後就會產 PDF 寄給飼主，而且鎖定不能再改，
// 所以每一條規則漏判的代價都是把不完整的醫療報告送出門。
//
// 測試刻意都用「組出一份 sections」的方式描述情境，而不是直接呼叫內部小函式：
// 這樣重構內部結構時測試不會跟著碎掉，它保護的是對外的判斷結果。

const section = (...items) => [{ key: 's1', title: '區塊', items }];

// 一份剛好過關的最小報告，各個測試在這上面做單點變動，
// 才看得出「是這個改動造成失敗」而不是本來就一堆問題。
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

  it('完全空白的報告會被擋下來', () => {
    const missing = validateFinalRecord(section());
    assert.ok(missing.some((m) => m.includes('基本量測')), `應提示缺臨床內容，實際：${missing}`);
  });

  it('只填了看診日期與獸醫師不算有臨床內容', () => {
    // 這兩個欄位有預設值／屬行政資訊，拿它們當「有填」的訊號會讓空報告過關。
    const missing = validateFinalRecord(
      section(
        { key: 'visitDate', label: '看診日期', type: 'date', role: 'visitDate', value: '2026-08-20' },
        { key: 'vet', label: '獸醫師', type: 'text', role: 'vet', value: '王醫師' }
      )
    );
    assert.ok(missing.some((m) => m.includes('基本量測')), `應提示缺臨床內容，實際：${missing}`);
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
    it('兩個都空白時會提示', () => {
      const sections = section(
        { key: 'weight', label: '體重', type: 'measurement', value: '4.2' },
        { key: 'conclusion', label: '結論', type: 'textarea', role: 'conclusion', value: '' },
        { key: 'plan', label: '照護建議', type: 'textarea', role: 'treatmentPlan', value: '' }
      );
      assert.ok(validateFinalRecord(sections).includes('結論或照護建議'));
    });

    it('只填其中一個就放行', () => {
      const sections = section(
        { key: 'weight', label: '體重', type: 'measurement', value: '4.2' },
        { key: 'conclusion', label: '結論', type: 'textarea', role: 'conclusion', value: '' },
        { key: 'plan', label: '照護建議', type: 'textarea', role: 'treatmentPlan', value: '每日餵藥一次' }
      );
      assert.deepEqual(validateFinalRecord(sections), []);
    });

    it('只有空白字元不算填了', () => {
      const sections = section(
        { key: 'weight', label: '體重', type: 'measurement', value: '4.2' },
        { key: 'conclusion', label: '結論', type: 'textarea', role: 'conclusion', value: '   ' }
      );
      assert.ok(validateFinalRecord(sections).includes('結論'));
    });

    it('兩個欄位都被停用時完全不檢查這條', () => {
      // 使用者可以在表單設計頁把這兩個欄位拿掉，那就不該再要求它們。
      const sections = section({ key: 'weight', label: '體重', type: 'measurement', value: '4.2' });
      assert.deepEqual(validateFinalRecord(sections), []);
    });
  });

  describe('異常項目必須寫說明', () => {
    it('理學檢查標記異常卻沒寫說明會被擋', () => {
      const sections = validSections();
      sections[0].items.push({ key: 'skin', label: '皮膚', type: 'finding', status: 'abnormal', note: '' });
      assert.ok(validateFinalRecord(sections).some((m) => m.includes('皮膚')));
    });

    it('寫了說明就放行', () => {
      const sections = validSections();
      sections[0].items.push({ key: 'skin', label: '皮膚', type: 'finding', status: 'abnormal', note: '背部有局部脫毛' });
      assert.deepEqual(validateFinalRecord(sections), []);
    });

    it('說明只有空白字元不算數', () => {
      const sections = validSections();
      sections[0].items.push({ key: 'skin', label: '皮膚', type: 'finding', status: 'abnormal', note: '   ' });
      assert.ok(validateFinalRecord(sections).some((m) => m.includes('皮膚')));
    });

    it('多個異常項目會一起列出來', () => {
      const sections = validSections();
      sections[0].items.push(
        { key: 'skin', label: '皮膚', type: 'finding', status: 'abnormal', note: '' },
        { key: 'alt', label: 'ALT', type: 'lab', status: 'abnormal', value: '120', note: '' }
      );
      const message = validateFinalRecord(sections).find((m) => m.includes('異常說明'));
      assert.ok(message.includes('皮膚') && message.includes('ALT'), `實際：${message}`);
    });
  });

  describe('檢驗數值格式', () => {
    it('填了非數字會被擋', () => {
      const sections = validSections();
      sections[0].items.push({ key: 'alt', label: 'ALT', type: 'lab', status: 'normal', value: '偏高' });
      assert.ok(validateFinalRecord(sections).some((m) => m.includes('ALT')));
    });

    it('numeric 為 false 的項目不檢查格式', () => {
      // 有些檢驗結果本來就是文字（例如「陰性」），範本可以把它標成非數值。
      const sections = validSections();
      sections[0].items.push({ key: 'fiv', label: 'FIV', type: 'lab', status: 'normal', value: '陰性', numeric: false });
      assert.deepEqual(validateFinalRecord(sections), []);
    });

    it('空值不算格式錯誤', () => {
      const sections = validSections();
      sections[0].items.push({ key: 'alt', label: 'ALT', type: 'lab', status: 'normal', value: '' });
      assert.deepEqual(validateFinalRecord(sections), []);
    });
  });
});

// itemHasAnswer 的分支是整份檢查的地基：臨床內容與必填兩條規則都建立在它上面，
// 判斷錯一種型別就會同時影響兩處，所以逐型別釘住。
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
