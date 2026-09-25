// 自由文字欄位的輕量格式標記（本次簡易紀錄、藥單、待辦）。欄位仍是一般字串，只多兩種標記：
//   粗體  **文字**
//   顏色  [red]文字[/red]    只認 RICH_TEXT_COLORS 的四個名字
// 換行就是 \n，標記不跨行；\ 可跳脫 \ * [。
//
// 為什麼不存 HTML：顯示端用這裡的 parser 拆成片段、以文字插值渲染，永遠不必 v-html，
// 也就不需要 sanitizer；字串欄位不變，既有的同步、衝突合併、樂觀鎖全都照舊。
// 不用 # 當標記，因為 #名字 是寵物標記。
// Dependency-free：瀏覽器與 API 共用同一份，標準化結果兩邊一定一致（編輯器送出的字串
// 跟伺服器 normalize 後的字串相同，才不會一載入就被判成「有修改」）。

// 值是語意 token 名：前端用 text-danger 這類 class 上色，明暗主題各自有定義。
export const RICH_TEXT_COLORS = Object.freeze({
  red: 'danger',
  orange: 'warning',
  green: 'success',
  blue: 'info',
});

const COLOR_NAMES = Object.keys(RICH_TEXT_COLORS);
const ESCAPABLE = new Set(['\\', '*', '[']);

function tagAt(line, index) {
  if (line[index] !== '[') return null;
  const close = line.indexOf(']', index);
  if (close < 0) return null;
  const body = line.slice(index + 1, close);
  const closing = body.startsWith('/');
  const name = closing ? body.slice(1) : body;
  if (!COLOR_NAMES.includes(name)) return null;
  return { name, closing, length: close - index + 1 };
}

function parseLine(line) {
  const segments = [];
  let bold = false;
  let color = null;
  let buffer = '';
  const flush = () => {
    if (!buffer) return;
    const last = segments.at(-1);
    if (last && last.bold === bold && last.color === color) last.text += buffer;
    else segments.push({ text: buffer, bold, color });
    buffer = '';
  };

  for (let index = 0; index < line.length;) {
    const char = line[index];
    if (char === '\\' && ESCAPABLE.has(line[index + 1])) {
      buffer += line[index + 1];
      index += 2;
      continue;
    }
    if (char === '*' && line[index + 1] === '*') {
      flush();
      bold = !bold;
      index += 2;
      continue;
    }
    const tag = tagAt(line, index);
    if (tag) {
      if (!tag.closing) {
        flush();
        color = tag.name;
      } else if (tag.name === color) {
        flush();
        color = null;
      }
      // 對不上目前顏色的關閉標記直接吃掉，不當成文字。
      index += tag.length;
      continue;
    }
    buffer += char;
    index += 1;
  }
  flush();
  return segments;
}

// 每行一個陣列：[[{ text, bold, color }], ...]；空行是 []。
export function parseRichText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').split('\n').map(parseLine);
}

const escapeText = (text) => text.replace(/[\\*[]/g, (char) => `\\${char}`);

// 標準形式：顏色在外、粗體在內，每行各自開關，相鄰同樣式的片段合併。
function serializeLine(segments) {
  let out = '';
  let bold = false;
  let color = null;
  for (const segment of segments) {
    const text = String(segment.text ?? '').replace(/\n/g, ' ');
    if (!text) continue;
    const nextColor = COLOR_NAMES.includes(segment.color) ? segment.color : null;
    const nextBold = Boolean(segment.bold);
    if (nextColor !== color) {
      if (bold) { out += '**'; bold = false; }
      if (color) out += `[/${color}]`;
      if (nextColor) out += `[${nextColor}]`;
      color = nextColor;
    }
    if (nextBold !== bold) {
      out += '**';
      bold = nextBold;
    }
    out += escapeText(text);
  }
  if (bold) out += '**';
  if (color) out += `[/${color}]`;
  return out;
}

export function serializeRichText(lines) {
  return (lines ?? []).map(serializeLine).join('\n');
}

export function normalizeRichText(value) {
  return serializeRichText(parseRichText(value));
}

export function richTextToPlain(value) {
  return parseRichText(value).map((segments) => segments.map((segment) => segment.text).join('')).join('\n');
}

// 字數限制一律算純文字長度，標記不佔額度。
export function richTextLength(value) {
  return richTextToPlain(value).length;
}
