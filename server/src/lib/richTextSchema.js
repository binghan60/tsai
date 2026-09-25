import { richTextLength } from '../../../shared/richText.js';

// 帶格式標記的欄位（shared/richText.js）在 schema 上的字數上限：算純文字長度，
// 標記不佔額度。直接用 maxlength 會連 ** 與 [red] 一起算，醫師加了顏色就莫名超過上限。
export function richTextMaxLength(max) {
  return {
    validator: (value) => value === null || value === undefined || richTextLength(value) <= max,
    message: `內容過長（最多 ${max} 字）`,
  };
}
