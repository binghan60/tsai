import { CLINIC_TIMEZONE } from './clinicTime.js';

const SENDER_LABEL = { vet: '醫生', front_desk: '櫃台' };

// 把掛號留言串組成一份易讀的逐則記錄文字，供落地到病歷日誌用。
// 單向：只有留言串會產生這份文字，反向的日誌編輯不會拆解回某一則留言。
export function formatVisitMessagesTranscript(messages) {
  if (!messages?.length) return '';
  return messages
    .map((message) => {
      // 正式環境伺服器通常跑在 UTC，時間要明講診所時區，不能吃系統預設時區。
      const time = new Date(message.createdAt).toLocaleTimeString('zh-TW', {
        timeZone: CLINIC_TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      return `[${time} ${SENDER_LABEL[message.sender] ?? message.sender}] ${message.content}`;
    })
    .join('\n');
}
