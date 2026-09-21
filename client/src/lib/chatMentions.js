// 內文裡標記寵物的純字串邏輯，聊天室與院內待辦共用，跟元件分開才能用 node --test 測。

// 觸發字元。用 # 而不是 @：@ 在中文輸入法與 email 之間太容易撞在一起，# 打起來也順手。
// 要換字元只改這一個常數，畫面上顯示標籤的地方也都讀它。
export const MENTION_TRIGGER = '#';

// 游標前面正在打的「# 加關鍵字」。# 前面緊接著英數字或 . _ % + -（email 帳號、網址錨點的組成）
// 時不觸發，避免 page#top 這類誤觸；中文、標點、空白、開頭之後都可以——中文打字不會在 # 前面
// 留空格，「回電給#豆豆」必須叫得出來。# 到游標之間不能有空白——打了空白就代表這個標記已經結束。
export function activeMentionQuery(text, caret) {
  const before = String(text ?? '').slice(0, caret);
  const match = before.match(/(^|[^A-Za-z0-9._%+-])#([^\s#]{0,20})$/);
  if (!match) return null;
  return { start: before.length - match[2].length - 1, query: match[2] };
}

// 把 start..caret 這段關鍵字換成 `#寵物名 `，回傳新文字與新游標位置。
export function insertMention(text, start, caret, name) {
  const value = String(text ?? '');
  const token = `${MENTION_TRIGGER}${name} `;
  return { text: value.slice(0, start) + token + value.slice(caret), caret: start + token.length };
}

// 送出前只留下內文裡還看得到 `#名字` 的標記——使用者選了之後又把字刪掉，就不該留著連結。
export function mentionsStillInContent(content, mentions) {
  const value = String(content ?? '');
  const seen = new Set();
  return (mentions ?? []).filter((mention) => {
    const id = String(mention.petId);
    if (seen.has(id) || !value.includes(`${MENTION_TRIGGER}${mention.petName}`)) return false;
    seen.add(id);
    return true;
  });
}

// 把內文拆成文字段與標記段，給畫面把 #名字 換成可點的標籤。
// 名字長的先比對，避免「豆豆」吃掉「豆豆二號」的前半段。
export function splitMentionSegments(content, mentions) {
  const value = String(content ?? '');
  const list = [...(mentions ?? [])].filter((mention) => mention?.petName).sort((a, b) => b.petName.length - a.petName.length);
  if (!list.length) return [{ type: 'text', text: value }];

  const segments = [];
  let buffer = '';
  let index = 0;
  while (index < value.length) {
    const mention = value[index] === MENTION_TRIGGER ? list.find((item) => value.startsWith(`${MENTION_TRIGGER}${item.petName}`, index)) : null;
    if (mention) {
      if (buffer) segments.push({ type: 'text', text: buffer });
      buffer = '';
      segments.push({ type: 'mention', mention });
      index += mention.petName.length + 1;
    } else {
      buffer += value[index];
      index += 1;
    }
  }
  if (buffer) segments.push({ type: 'text', text: buffer });
  return segments;
}
