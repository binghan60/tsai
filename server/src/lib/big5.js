import { TextDecoder } from 'node:util';

// 把文字編成 Big5 位元組。IDEXX 給的報到範例是 Big5，中文貓名用 UTF-8 送過去可能在 IDEXX 主機上變亂碼
// （到診所才能確認，所以伺服器可以切換，見 config/idexxBridge.js）。
//
// Node 內建的 TextDecoder 會解 Big5、但沒有編碼器；不為了這一件事多裝 iconv-lite，
// 第一次用到時把標準 Big5 範圍（首位元組 0xA1–0xF9，也就是 Windows 繁中 CP950 的範圍）逐一解碼一次，反查成對照表。
// 刻意不收 HKSCS 等延伸區：IDEXX 主機不一定認得，寧可換成「?」也不要送出對方解不出的位元組。
let table = null;

function big5Table() {
  if (table) return table;
  table = new Map();
  const decoder = new TextDecoder('big5');
  const pair = Buffer.alloc(2);
  for (let lead = 0xa1; lead <= 0xf9; lead += 1) {
    for (let trail = 0x40; trail <= 0xfe; trail += 1) {
      if (trail > 0x7e && trail < 0xa1) continue;
      pair[0] = lead;
      pair[1] = trail;
      const char = decoder.decode(pair);
      // 同一個字在 Big5 裡出現兩次時用前面那個（標準區排在前面）。
      if ([...char].length === 1 && char !== '�' && !table.has(char)) table.set(char, [lead, trail]);
    }
  }
  return table;
}

// 回傳 { bytes, unmappable }：Big5 沒有的字換成「?」，unmappable 列出被換掉的字給呼叫端記錄。
export function encodeBig5(text) {
  const map = big5Table();
  const bytes = [];
  const unmappable = [];
  for (const char of String(text ?? '')) {
    const code = char.codePointAt(0);
    if (code < 0x80) {
      bytes.push(code);
      continue;
    }
    const encoded = map.get(char);
    if (encoded) {
      bytes.push(...encoded);
    } else {
      bytes.push(0x3f);
      unmappable.push(char);
    }
  }
  return { bytes: Buffer.from(bytes), unmappable };
}
