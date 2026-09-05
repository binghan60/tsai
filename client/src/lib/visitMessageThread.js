// POST 的回應與 socket 廣播可能重複送到同一則留言，用 _id 防止插入兩次。
export function mergeVisitMessage(messages, message) {
  if (!message) return messages;
  if (messages.some((item) => item._id === message._id)) return messages;
  return [...messages, message];
}

export function visitMessageSenderLabel(sender) {
  return sender === 'front_desk' ? '櫃台' : '醫生';
}
