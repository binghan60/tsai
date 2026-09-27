import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brushTooth, dentalSummary, hasDentalContent, normalizeDental } from './dentalChart.js';

test('舊資料沒有 restNormal 也讀得進來', () => {
  assert.deepEqual(normalizeDental({ teeth: { 104: { status: 'calculus' } } }), { teeth: { 104: { status: 'calculus' } }, restNormal: false });
  assert.deepEqual(normalizeDental('壞掉的值'), { teeth: {}, restNormal: false });
});

test('只按了「其餘全部正常」也算有填', () => {
  assert.equal(hasDentalContent({ teeth: {}, restNormal: true }), true);
  assert.equal(hasDentalContent({ teeth: {} }), false);
});

test('摘要依狀況分組、牙位照數字排，備註另外列', () => {
  const summary = dentalSummary({
    teeth: { 204: { status: 'calculus' }, 104: { status: 'calculus', note: '中度' }, 307: { status: 'extracted' }, 109: { status: '', note: '待觀察' } },
    restNormal: true,
  });
  assert.deepEqual(summary.groups.map((group) => [group.label, group.codes]), [['牙結石', ['104', '204']], ['拔除', ['307']]]);
  assert.deepEqual(summary.notes.map((note) => [note.code, note.note]), [['104', '中度'], ['109', '待觀察']]);
  assert.equal(summary.restNormal, true);
});

test('刷子點同一個狀況是拿掉；有備註時只清狀況不丟備註', () => {
  let chart = brushTooth({ teeth: {} }, '104', 'calculus');
  assert.equal(chart.teeth['104'].status, 'calculus');
  chart = brushTooth(chart, '104', 'calculus');
  assert.equal('104' in chart.teeth, false);
  chart = brushTooth({ teeth: { 104: { status: 'calculus', note: '中度' } } }, '104', 'calculus');
  assert.deepEqual(chart.teeth['104'], { status: '', note: '中度' });
});
