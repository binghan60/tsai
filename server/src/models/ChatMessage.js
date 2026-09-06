import mongoose from 'mongoose';

// 醫生↔櫃台的全站內部聊天，跟任何掛號／病患都無關（例如「今天下午提早關診」），
// 所以不像 clinicalNotes/visitNote 那樣掛在 petId/appointmentId 底下。
const chatMessageSchema = new mongoose.Schema(
  {
    sender: { type: String, enum: ['vet', 'front_desk'], required: true },
    content: { type: String, required: true, trim: true, maxlength: 1000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
chatMessageSchema.index({ createdAt: 1 });

export default mongoose.model('ChatMessage', chatMessageSchema);
