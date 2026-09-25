import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRichText, parseRichText, richTextLength, richTextToPlain, serializeRichText } from '../../../shared/richText.js';
import { docToRichText, richTextToDoc } from './richTextDoc.js';

describe('parseRichText', () => {
  it('純文字原樣保留，一行一個陣列', () => {
    assert.deepEqual(parseRichText('傷口良好\n\n回診'), [
      [{ text: '傷口良好', bold: false, color: null }],
      [],
      [{ text: '回診', bold: false, color: null }],
    ]);
  });

  it('粗體與顏色可以疊用', () => {
    assert.deepEqual(parseRichText('請注意：[red]**不可舔舐**傷口[/red]'), [[
      { text: '請注意：', bold: false, color: null },
      { text: '不可舔舐', bold: true, color: 'red' },
      { text: '傷口', bold: false, color: 'red' },
    ]]);
  });

  it('單一星號、不認得的方括號與跳脫都當成文字', () => {
    assert.deepEqual(parseRichText('3*2 [備註] [purple]x[/purple] \\*\\*不是粗體'), [[
      { text: '3*2 [備註] [purple]x[/purple] **不是粗體', bold: false, color: null },
    ]]);
  });

  it('標記不跨行：沒關的粗體到行尾就結束', () => {
    const [first, second] = parseRichText('**第一行\n第二行');
    assert.equal(first[0].bold, true);
    assert.equal(second[0].bold, false);
  });
});

describe('serializeRichText／normalizeRichText', () => {
  it('標準形式來回一致', () => {
    const value = '請注意：[red]**不可舔舐**傷口[/red]\n\n3\\*2 \\[備註]';
    assert.equal(normalizeRichText(value), value);
    assert.equal(serializeRichText(parseRichText(value)), value);
  });

  it('粗體在外、顏色在內的寫法會被整理成顏色在外', () => {
    assert.equal(normalizeRichText('**[blue]藍色粗體[/blue]**'), '[blue]**藍色粗體**[/blue]');
  });

  it('空字串維持空字串', () => {
    assert.equal(normalizeRichText(''), '');
  });
});

describe('richTextToPlain／richTextLength', () => {
  it('去掉標記、保留換行，字數只算純文字', () => {
    const value = '[red]**不可舔舐**[/red]\n3\\*2';
    assert.equal(richTextToPlain(value), '不可舔舐\n3*2');
    assert.equal(richTextLength(value), 8);
  });
});

describe('Tiptap 文件轉換', () => {
  it('標記 → 文件 → 標記 來回一致', () => {
    const value = '請注意：[red]**不可舔舐**傷口[/red]\n\n[green]已改善[/green]';
    assert.equal(docToRichText(richTextToDoc(value)), value);
  });

  it('文件裡不認得的顏色被丟掉', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '字', marks: [{ type: 'tint', attrs: { color: 'purple' } }] }] }] };
    assert.equal(docToRichText(doc), '字');
  });
});
