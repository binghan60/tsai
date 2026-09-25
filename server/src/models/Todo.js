import mongoose from 'mongoose';
import { richTextMaxLength } from '../lib/richTextSchema.js';

// 全站共用的院內待辦：「明天叫貨」「回電給王小姐」這類行政雜務，跟任何掛號無關。
// 沒有指派對象——診所只有醫生／櫃台兩種裝置身分，指派沒有可以落腳的「人」。
//
// 連結寵物不是獨立欄位，而是內文裡直接打 `#寵物名`（跟聊天室同一套），被標記的寵物
// 存在 mentions；名字與飼主姓名是快照，寵物之後改名，這筆待辦仍讀得懂。
// 寵物被刪除時該筆的 petId 會被清成 null、快照保留（見 routes/pets.js）。
const todoSchema = new mongoose.Schema(
  {
    // 可以上色、加粗（shared/richText.js），500 字算的是純文字。
    content: { type: String, required: true, trim: true, validate: richTextMaxLength(500) },
    createdBy: { type: String, enum: ['vet', 'front_desk'], required: true },
    // YYYY-MM-DD 字串，理由跟 Appointment.date 一樣：避免日期因伺服器時區偏移。
    dueDate: { type: String, default: null, match: /^\d{4}-\d{2}-\d{2}$/ },
    status: { type: String, enum: ['open', 'done'], default: 'open' },
    doneAt: { type: Date, default: null },
    doneBy: { type: String, enum: ['vet', 'front_desk', null], default: null },
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
// 刪除寵物時要找出標記了它的待辦。
todoSchema.index({ 'mentions.petId': 1 });

export default mongoose.model('Todo', todoSchema);
