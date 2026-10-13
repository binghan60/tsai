// 「這個 collection 有變動就通知前端重讀」的 Mongoose plugin。
//
// 為什麼放在 model 層而不是每支路由各自 emit：有些異動不是從路由來的（PDF 背景工作、寄信結果、
// 退信讀取、啟動時補跑的工作），逐一找出來補 emit 一定會漏；model 層的 hook 不管從哪裡寫都會觸發。
// 通知只是失效訊號（沒有內容），前端自己重讀，所以多發沒有害處；emit 端另外合併短時間內的多次
// （lib/realtime.js 的 coalescedEmitter，並且延後一小段，避開 transaction 還沒 commit 就重讀到舊資料）。
const QUERY_OPS = ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'replaceOne', 'deleteOne', 'deleteMany'];

export function liveInvalidation(schema, emit) {
  const notify = () => {
    try {
      emit();
    } catch {
      // 通知失敗不能讓資料寫入失敗。
    }
  };
  schema.post('save', notify);
  schema.post('insertMany', notify);
  schema.post('deleteOne', { document: true, query: false }, notify);
  for (const op of QUERY_OPS) schema.post(op, { document: false, query: true }, notify);
}
