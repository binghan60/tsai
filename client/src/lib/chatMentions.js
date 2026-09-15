// 聊天室 @ 標記寵物的純字串邏輯，跟元件分開才能用 node --test 測。

// 游標前面正在打的 @關鍵字。@ 必須在開頭或空白之後（避免 email 之類誤觸），
// @ 到游標之間不能有空白——打了空白就代表這個標記已經結束。
export function activeMentionQuery(text, caret) {
  const before = String(text ?? '').slice(0, caret);
  const match = before.match(/(^|\s)@([^\s@]{0,20})$/);
  if (!match) return null;
  return { start: before.length - match[2].length - 1, query: match[2] };
}

// 把 start..caret 這段 @關鍵字換成 `@寵物名 `，回傳新文字與新游標位置。
export function insertMention(text, start, caret, name) {
  const value = String(text ?? '');
  const token = `@${name} `;
  return { text: value.slice(0, start) + token + value.slice(caret), caret: start + token.length };
}

// 送出前只留下內文裡還看得到 `@名字` 的標記——使用者選了之後又把字刪掉，就不該放進暫存區。
export function mentionsStillInContent(content, mentions) {
  const value = String(content ?? '');
  const seen = new Set();
  return (mentions ?? []).filter((mention) => {
    const id = String(mention.petId);
    if (seen.has(id) || !value.includes(`@${mention.petName}`)) return false;
    seen.add(id);
    return true;
  });
}

// 把訊息內文拆成文字段與標記段，給畫面把 @名字 換成可點的標籤。
// 名字長的先比對，避免「豆豆」吃掉「豆豆二號」的前半段。
export function splitMentionSegments(content, mentions) {
  const value = String(content ?? '');
  const list = [...(mentions ?? [])].filter((mention) => mention?.petName).sort((a, b) => b.petName.length - a.petName.length);
  if (!list.length) return [{ type: 'text', text: value }];

  const segments = [];
  let buffer = '';
  let index = 0;
  while (index < value.length) {
    const mention = value[index] === '@' ? list.find((item) => value.startsWith(`@${item.petName}`, index)) : null;
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
