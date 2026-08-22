import mongoose from 'mongoose';

// 報告寄送的事件流水帳。只增不改，每一次寄送嘗試都留下一筆。
//
// 為什麼不繼續用 MedicalRecord 上的 sentAt／sentTo／emailMessageId：
// 那些是單值欄位，重寄一次就整組覆蓋。寄失敗後重寄成功，失敗那次連錯誤原因一起消失；
// 飼主改了 Email 之後重寄，寄給舊信箱的事實也跟著不見。醫療報告寄給過誰、什麼時候寄的，
// 是事後要查得出來的事，不能只留最後一次。
//
// 為什麼是獨立 collection 而不是內嵌陣列：報告可以被刪除（草稿與未寄送的），
// 內嵌的話會跟著報告一起消失，等於沒有解決問題。
const deliveryLogSchema = new mongoose.Schema(
  {
    // 不設 ref／populate：這筆紀錄要能在報告被刪除之後繼續存在，
    // populate 到一個已刪除的文件只會拿到 null。下面幾個欄位就是為此冗餘保存的。
    recordId: { type: mongoose.Schema.Types.ObjectId, required: true },
    reportNumber: { type: String, default: '' },
    petName: { type: String, default: '' },
    ownerName: { type: String, default: '' },
    // 同一次寄送會先寫 queued，再寫最終結果。用同一個 attemptId 把兩個事件串在一起，
    // 稽核資料仍完整，操作介面則可以整理成一次嘗試只顯示一列。
    attemptId: { type: String, default: '' },

    // queued＝已送進寄送流程（PDF 還在產、SMTP 還沒回應），
    // uncertain 代表 SMTP 可能已接受，但本機無法確認最後狀態；不可當成單純失敗自動重送。
    event: { type: String, enum: ['queued', 'sent', 'failed', 'uncertain'], required: true },
    recipient: { type: String, default: '' },
    messageId: { type: String, default: '' },
    error: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// 兩種查法：看某一份報告的寄送歷程，以及看全部寄送紀錄（含已刪除報告的）。
deliveryLogSchema.index({ recordId: 1, createdAt: -1 });
deliveryLogSchema.index({ attemptId: 1, createdAt: 1 });
deliveryLogSchema.index({ createdAt: -1 });

export default mongoose.model('DeliveryLog', deliveryLogSchema);
