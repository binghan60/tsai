import mongoose from 'mongoose';

// 飼主公開填寫的初診資料先暫存在這裡；核准前絕不混入正式飼主／寵物資料。
const intakeSubmissionSchema = new mongoose.Schema(
  {
    owner: {
      name: { type: String, required: true, trim: true },
      phone: { type: String, required: true, trim: true },
      landline: { type: String, default: '', trim: true },
      email: { type: String, default: '', trim: true },
      address: { type: String, default: '', trim: true },
    },
    pet: {
      name: { type: String, required: true, trim: true },
      species: { type: String, default: '貓', trim: true },
      breed: { type: String, default: '', trim: true },
      color: { type: String, default: '', trim: true },
      sex: { type: String, enum: ['unknown', 'male', 'female'], default: 'unknown' },
      neutered: { type: String, enum: ['unknown', 'yes', 'no'], default: 'unknown' },
      birthDate: { type: Date, default: null },
      birthDateEstimated: { type: Boolean, default: false },
      householdCatCount: { type: Number, min: 0, default: null },
      diet: { type: String, default: '', trim: true },
      foods: { type: [String], default: [] },
      feedingType: { type: String, enum: ['unknown', 'free', 'scheduled'], default: 'unknown' },
      mealsPerDay: { type: Number, min: 1, default: null },
      vaccineStatus: { type: String, enum: ['unknown', 'none', 'done'], default: 'unknown' },
      vaccineDate: { type: String, default: '', trim: true },
      medicalHistory: { type: [String], default: [] },
      medicalHistoryOther: { type: String, default: '', trim: true },
      allergyStatus: { type: String, enum: ['unknown', 'none', 'yes'], default: 'unknown' },
      allergyType: { type: String, default: '', trim: true },
      checkupStatus: { type: String, enum: ['unknown', 'none', 'done'], default: 'unknown' },
      checkupDate: { type: String, default: '', trim: true },
    },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reviewNote: { type: String, default: '', trim: true, maxlength: 500 },
    reviewedAt: { type: Date, default: null },
    approvedOwnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', default: null },
    approvedPetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', default: null },
  },
  { timestamps: true, optimisticConcurrency: true }
);

intakeSubmissionSchema.index({ status: 1, createdAt: 1, _id: 1 });

export default mongoose.model('IntakeSubmission', intakeSubmissionSchema);
