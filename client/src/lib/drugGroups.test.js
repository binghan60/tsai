import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { groupDrugs, searchDrugs } from './drugGroups.js';

const groups = [
  { _id: 'g2', name: '抗生素', sortOrder: 1 },
  { _id: 'g1', name: '腸胃', sortOrder: 0 },
];
const drugs = [
  { _id: 'a', name: 'Famotidine', groupId: 'g1', sortOrder: 1 },
  { _id: 'b', name: 'Metoclopramide', groupId: 'g1', sortOrder: 0 },
  { _id: 'c', name: 'Amoxicillin', groupId: 'g2', sortOrder: 0, enabled: false },
  { _id: 'd', name: 'Probiotics', groupId: null },
  { _id: 'e', name: '孤兒', groupId: 'gone', sortOrder: 0 },
];

describe('groupDrugs', () => {
  it('分類依手動順序、組內依手動順序，未分類固定最後；指向已刪分類的藥歸到未分類', () => {
    const result = groupDrugs(groups, drugs);
    assert.deepEqual(result.map((entry) => entry.name), ['腸胃', '抗生素', '未分類']);
    assert.deepEqual(result[0].drugs.map((drug) => drug._id), ['b', 'a']);
    assert.deepEqual(result[2].drugs.map((drug) => drug._id).sort(), ['d', 'e']);
    assert.equal(result[2].id, null);
  });

  it('enabledOnly 不列停用的，空分類仍保留', () => {
    const result = groupDrugs(groups, drugs, { enabledOnly: true });
    assert.deepEqual(result[1].drugs, []);
  });
});

describe('searchDrugs', () => {
  it('不分大小寫、任何位置', () => {
    assert.deepEqual(searchDrugs(drugs, 'FAMO').map((drug) => drug._id), ['a']);
    assert.deepEqual(searchDrugs(drugs, '  '), []);
    assert.deepEqual(searchDrugs([{ _id: 'r', name: '**[red]Famotidine[/red]**' }], 'famo').map((drug) => drug._id), ['r']);
  });
});
