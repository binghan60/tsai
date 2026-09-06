import mongoose from 'mongoose';

// 醫生↔櫃台的全站內部聊天，跟任何掛號／病患都無關（例如「今天下午提早關診」），
// 所以不像 clinicalNotes/visitNote 那樣掛在 petId/appointmentId 底下。
const chatMessageSchema = new mongoose.Schema(
  {
    sender: { type: String, enum: ['vet', 'front_desk'], required: true },
    content: { type: String, required: true, trim: true, maxlength: 1000 },
    // 掛號頁的動作（報到、取消、完成看診…）會自動補一則描述訊息（見前端
    // AppointmentsPage.vue 的 notifyChat），跟使用者手動打字送出的訊息共用同一份
    // 紀錄，這個欄位只是給前端標註來源、決定要不要算進未讀與怎麼顯示用。
    auto: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
chatMessageSchema.index({ createdAt: 1 });

export default mongoose.model('ChatMessage', chatMessageSchema);
