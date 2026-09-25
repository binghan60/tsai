import { parseRichText, serializeRichText, RICH_TEXT_COLORS } from '../../../shared/richText.js';

// 格式標記字串 ⇄ Tiptap（ProseMirror）文件 JSON。一行一個 paragraph，
// 粗體是 bold mark，顏色是自訂的 tint mark（見 components/RichTextEditor.vue）。

export function richTextToDoc(value) {
  return {
    type: 'doc',
    content: parseRichText(value).map((segments) => {
      const content = segments.map((segment) => {
        const marks = [];
        if (segment.bold) marks.push({ type: 'bold' });
        if (segment.color) marks.push({ type: 'tint', attrs: { color: segment.color } });
        return marks.length ? { type: 'text', text: segment.text, marks } : { type: 'text', text: segment.text };
      });
      return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
    }),
  };
}

export function docToRichText(doc) {
  const lines = (doc?.content ?? []).map((block) =>
    (block.content ?? [])
      .filter((node) => node.type === 'text' && node.text)
      .map((node) => {
        const marks = node.marks ?? [];
        const tint = marks.find((mark) => mark.type === 'tint')?.attrs?.color;
        return {
          text: node.text,
          bold: marks.some((mark) => mark.type === 'bold'),
          color: RICH_TEXT_COLORS[tint] ? tint : null,
        };
      })
  );
  return serializeRichText(lines.length ? lines : [[]]);
}
