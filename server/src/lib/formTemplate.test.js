import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRecordFields, missingRoles, sanitizeSections, storageFor } from './formTemplate.js';

// 這裡測的是表單範本的「身分制度」。
//
// key 就是項目的身分：報告的作答、已結案報告的快照、常用語的歸屬全都靠它對應。
// key 被換掉或被安到別的項目身上，後果不是畫面壞掉，而是病歷上的數字接到錯的欄位——
// 而且沒有任何一步會失敗。所以這幾條釘的都是「什麼情況下 key 會變、什麼情況下不會」。

// existing 是資料庫裡目前那份範本，sanitizeSections 靠它判斷哪些 key 可以沿用。
const existing = (sections = [], retiredKeys = []) => ({ sections, retiredKeys });
const section = (key, title, items = [], extra = {}) => ({ key, title, items, ...extra });
const item = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });

describe('sanitizeSections：key 的沿用與汰換', () => {
  it('既有的 key 一律沿用，使用者改的是 label', () => {
    const before = existing([section('sec_a', '原標題', [item('item_a', '原名稱')])]);
    const { sections } = sanitizeSections(
      [section('sec_a', '改過的標題', [item('item_a', '改過的名稱')])],
      before
    );

    assert.equal(sections[0].key, 'sec_a');
    assert.equal(sections[0].title, '改過的標題');
    assert.equal(sections[0].items[0].key, 'item_a');
    assert.equal(sections[0].items[0].label, '改過的名稱');
  });

  it('新增的區塊與項目由後端配 key，不採用前端送來的暫時 key', () => {
    const { sections } = sanitizeSections(
      [section('__new_section_1', '新區塊', [item('__new_item_1', '新項目')])],
      existing()
    );

    assert.match(sections[0].key, /^section_/);
    assert.match(sections[0].items[0].key, /^custom_/);
  });

  // 前端送一個不屬於這份範本的 key（別份範本的、或手動改過的），代表有人想把某個項目的
  // 識別碼安到別的項目上。無法分辨意圖，一律當成新項目重配。
  it('不屬於這份範本的 key 不會被沿用', () => {
    const before = existing([section('sec_a', '區塊', [item('item_a', '項目')])]);
    const { sections } = sanitizeSections(
      [section('sec_a', '區塊', [item('item_from_another_template', '項目')])],
      before
    );

    assert.notEqual(sections[0].items[0].key, 'item_from_another_template');
    assert.match(sections[0].items[0].key, /^custom_/);
  });

  it('已刪除（retired）的 key 不會被復活', () => {
    const before = existing([section('sec_a', '區塊')], ['custom_dead']);
    const { sections } = sanitizeSections(
      [section('sec_a', '區塊', [item('custom_dead', '想搶用舊 key 的新項目')])],
      before
    );

    assert.notEqual(sections[0].items[0].key, 'custom_dead');
  });

  it('同一次送出的內容裡有重複 key 就整份拒收，不會只寫一半', () => {
    const before = existing([section('sec_a', '區塊', [item('dup', '原項目')])]);
    const result = sanitizeSections(
      [section('sec_a', '區塊', [item('dup', '第一個'), item('dup', '第二個')])],
      before
    );

    assert.match(result.error, /重複的識別碼/);
    assert.equal(result.sections, undefined);
  });

  it('這次存檔後消失的 key 全部歸入 retiredKeys，還在的不會', () => {
    const before = existing([section('sec_a', '區塊', [item('item_a', 'A'), item('item_b', 'B')])]);
    const { retiredKeys } = sanitizeSections(
      [section('sec_a', '區塊', [item('item_a', 'A')])],
      before
    );

    assert.ok(retiredKeys.includes('item_b'), `item_b 應該被歸檔，實際：${retiredKeys}`);
    assert.ok(!retiredKeys.includes('item_a'));
  });

  it('先前累積的 retiredKeys 會一路帶下去', () => {
    const { retiredKeys } = sanitizeSections([], existing([], ['custom_old']));
    assert.deepEqual(retiredKeys, ['custom_old']);
  });

  // 種子範本裡「結論」既是區塊也是項目。兩者同名不衝突，只要各自不重複即可——
  // 把它們當成同一個命名空間的話，刪掉結論區塊會連帶讓結論欄位被迫改名。
  it('區塊與項目是兩個獨立的命名空間，同名不互相干擾', () => {
    const before = existing([section('conclusion', '結論', [item('conclusion', '結論', 'textarea')])]);
    const { sections } = sanitizeSections(
      [section('conclusion', '結論', [item('conclusion', '結論', 'textarea')])],
      before
    );

    assert.equal(sections[0].key, 'conclusion');
    assert.equal(sections[0].items[0].key, 'conclusion');
  });
});

describe('sanitizeSections：欄位正規化', () => {
  it('不在白名單裡的型別、角色、版式與寬度都退回預設值', () => {
    const { sections } = sanitizeSections(
      [section('', '', [item('', '', '不存在的型別', { role: '不存在的角色', span: '超寬' })], { presentation: '不存在的版式' })],
      existing()
    );

    assert.equal(sections[0].presentation, 'keyValue');
    assert.equal(sections[0].title, '未命名區塊');
    assert.equal(sections[0].items[0].type, 'text');
    assert.equal(sections[0].items[0].role, null);
    assert.equal(sections[0].items[0].span, 'auto');
    assert.equal(sections[0].items[0].label, '未命名項目');
  });

  it('order 一律照送出的順序重編，不採用前端帶的值', () => {
    const { sections } = sanitizeSections(
      [
        section('', 'B', [], { order: 99 }),
        section('', 'A', [item('', '第一個', 'text', { order: 50 }), item('', '第二個', 'text', { order: 1 })]),
      ],
      existing()
    );

    assert.deepEqual(sections.map((entry) => entry.order), [0, 1]);
    assert.deepEqual(sections[1].items.map((entry) => entry.order), [0, 1]);
  });

  it('選項會去頭尾空白並丟掉空字串', () => {
    const { sections } = sanitizeSections(
      [section('', '區塊', [item('', '判讀', 'select', { options: ['  正常  ', '', '   ', '異常'] })])],
      existing()
    );

    assert.deepEqual(sections[0].items[0].options, ['正常', '異常']);
  });

  // Number('  ') 是 0 不是 NaN。沒有先 trim 的話，在上限欄位打幾個空白會被存成 0，
  // 而 max 為 0 會讓每個填進去的數值都超出上限，那份報告就再也結不了案。
  it('數值欄位只有空白時是 null，不是 0', () => {
    const { sections } = sanitizeSections(
      [section('', '區塊', [item('', '體態評分', 'number', {
        min: '  ', max: '  ', step: '  ', referenceMin: '  ', referenceMax: '  ',
      })])],
      existing()
    );

    const saved = sections[0].items[0];
    assert.deepEqual(
      [saved.min, saved.max, saved.step, saved.referenceMin, saved.referenceMax],
      [null, null, null, null, null]
    );
  });

  it('數值欄位填了非數字是 null，不是 NaN（NaN 會讓整份範本存不進去）', () => {
    const { sections } = sanitizeSections(
      [section('', '區塊', [item('', '體態評分', 'number', { min: 'abc', max: 'abc', step: 'abc' })])],
      existing()
    );

    const saved = sections[0].items[0];
    assert.deepEqual([saved.min, saved.max, saved.step], [null, null, null]);
  });

  it('正常的數值照樣存得進去', () => {
    const { sections } = sanitizeSections(
      [section('', '區塊', [item('', '體態評分', 'number', { min: 1, max: '9', step: '0.5', referenceMin: '4', referenceMax: 5 })])],
      existing()
    );

    const saved = sections[0].items[0];
    assert.deepEqual(
      [saved.min, saved.max, saved.step, saved.referenceMin, saved.referenceMax],
      [1, 9, 0.5, 4, 5]
    );
  });

  it('enabled／required／numeric 的預設方向各自不同', () => {
    const { sections } = sanitizeSections(
      [section('', '區塊', [item('', '項目')])],
      existing()
    );

    const saved = sections[0].items[0];
    // 沒講就是啟用、非必填、當數值處理
    assert.equal(saved.enabled, true);
    assert.equal(saved.required, false);
    assert.equal(saved.numeric, true);
  });
});

describe('defaultRecordFields', () => {
  it('applies valid defaults to named fields and custom values', () => {
    const template = {
      sections: [section('basic', '基本資料', [
        item('chiefComplaint', '主訴', 'textarea', { defaultValue: '例行追蹤' }),
        item('custom_note', '提醒', 'text', { defaultValue: '空腹採血' }),
        item('custom_choices', '狀態', 'checkbox', { defaultValue: '食慾正常, 精神正常, 不存在', options: ['食慾正常', '精神正常'] }),
        item('custom_select', '結果', 'select', { defaultValue: '正常', options: ['正常', '異常'] }),
        item('custom_invalid', '結果', 'radio', { defaultValue: '不存在', options: ['正常'] }),
      ])],
    };

    assert.deepEqual(defaultRecordFields(template), {
      chiefComplaint: '例行追蹤',
      customValues: {
        custom_note: '空腹採血',
        custom_choices: ['食慾正常', '精神正常'],
        custom_select: '正常',
      },
    });
  });
});

describe('missingRoles', () => {
  const withRole = (enabled = true, sectionEnabled = true) =>
    [{ key: 's', enabled: sectionEnabled, items: [{ key: 'i', role: 'weight', enabled }] }];

  it('帶 role 的項目被刪掉會被回報', () => {
    const before = { sections: withRole() };
    assert.deepEqual(missingRoles([{ key: 's', enabled: true, items: [] }], before), ['weight']);
  });

  it('只是改名不算移除', () => {
    const before = { sections: withRole() };
    const after = [{ key: 's', enabled: true, items: [{ key: 'i', role: 'weight', enabled: true, label: '新名字' }] }];
    assert.deepEqual(missingRoles(after, before), []);
  });

  it('停用帶 role 的項目等同移除', () => {
    assert.deepEqual(missingRoles(withRole(false), { sections: withRole(true) }), ['weight']);
  });

  // before／after 的條件必須對稱。不對稱的話，區塊一停用就會每次儲存都重跳同一則確認，
  // 使用者只能一路按「確認」，這個提醒也就失去意義了。
  it('區塊停用之後再次儲存，不會重複跳出同一則提醒', () => {
    const disabled = withRole(true, false);
    assert.deepEqual(missingRoles(disabled, { sections: disabled }), []);
  });
});

describe('storageFor：這個項目的作答存在哪裡', () => {
  it('理學檢查與檢驗有自己的陣列', () => {
    assert.equal(storageFor({ type: 'finding', key: 'oral' }), 'examinationFindings');
    assert.equal(storageFor({ type: 'lab', key: 'bun' }), 'labFindings');
  });

  it('型別與具名欄位相符時存進具名欄位', () => {
    assert.equal(storageFor({ type: 'measurement', key: 'weightKg' }), 'field');
    assert.equal(storageFor({ type: 'date', key: 'visitDate' }), 'field');
    assert.equal(storageFor({ type: 'textarea', key: 'conclusion' }), 'field');
  });

  // 範本要能自由改型別，就不能硬塞進型別固定的 schema 欄位——
  // 把體溫改成文字後填「微燒」會 cast 失敗，整份草稿存不進去。
  it('型別與具名欄位對不上時改收進 customValues', () => {
    assert.equal(storageFor({ type: 'text', key: 'temperatureC' }), 'custom');
    assert.equal(storageFor({ type: 'number', key: 'conclusion' }), 'custom');
  });

  it('複選的作答是陣列，塞不進任何具名欄位', () => {
    assert.equal(storageFor({ type: 'checkbox', key: 'chiefComplaint' }), 'custom');
  });

  it('沒有對應具名欄位的自訂項目一律 custom', () => {
    assert.equal(storageFor({ type: 'text', key: 'custom_ab12cd' }), 'custom');
  });
});
