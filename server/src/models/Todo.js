import mongoose from 'mongoose';
import { richTextMaxLength } from '../lib/richTextSchema.js';

// 全站共用的院內待辦：「明天叫貨」「回電給王小姐」這類行政雜務，跟任何掛號無關。
// 沒有指派對象——診所只有醫師／櫃台兩種裝置身分，指派沒有可以落腳的「人」。
//
// 連結貓咪不是獨立欄位，而是內文裡直接打 `#貓咪名`（跟聊天室同一套），被標記的貓咪
// 存在 mentions；名字與飼主姓名是快照，貓咪之後改名，這筆待辦仍讀得懂。
// 貓咪被刪除時該筆的 petId 會被清成 null、快照保留（見 routes/pets.js）。
const todoSchema = new mongoose.Schema(
  {
    // 可以上色、加粗（shared/richText.js），500 字算的是純文字。
    content: { type: String, required: true, trim: true, validate: richTextMaxLength(500) },
    createdBy: { type: String, enum: ['vet', 'front_desk'], required: true },
    // YYYY-MM-DD 字串，理由跟 Appointment.date 一樣：避免日期因伺服器時區偏移。
    dueDate: { type: String, default: null, match: /^\d{4}-\d{2}-\d{2}$/ },
    // 星號只是標記（「這件比較急」），不影響排序。
    starred: { type: Boolean, default: false },
    // 手動順序（拖拉排序，shared/todoOrder.js）：數字小的在上面。沒有值時以建立時間（毫秒）代替，
    // 所以新增的一律在最下面；拖拉後整份未完成清單重新編號；改回未完成時換成當下時間，回到最下面。
    // 刻意不設 default：Mongoose 讀出沒有這欄的舊文件時會補上 default，下次 save 就寫進去，
    // 一筆舊待辦只是標個星號就會跳到最下面。
    sortOrder: { type: Number },
    status: { type: String, enum: ['open', 'done'], default: 'open' },
    doneAt: { type: Date, default: null },
    doneBy: { type: String, enum: ['vet', 'front_desk', null], default: null },
    // 處理過程：「10/12 打過沒接、10/13 已回電，下週二來」。純文字、可多行、選填；完成後純展示，不能再改。
    // 未完成而有內容＝畫面標「處理中」（不是另一個 status，只看這欄有沒有字）。
    progress: { type: String, trim: true, maxlength: 500, default: '' },
    mentions: {
      type: [new mongoose.Schema({
        petId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', default: null },
        petName: { type: String, required: true },
        ownerName: { type: String, default: '' },
      }, { _id: false })],
      default: [],
    },
  },
  { timestamps: true }
);
// 前兩條各對應 listTodos 的一個查詢：未完成清單、最近完成清單。
todoSchema.index({ status: 1, createdAt: 1 });
todoSchema.index({ status: 1, doneAt: -1 });
// 刪除貓咪時要找出標記了它的待辦。
todoSchema.index({ 'mentions.petId': 1 });

export default mongoose.model('Todo', todoSchema);
