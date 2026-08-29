import mongoose from 'mongoose';

// 全診所共用的偏好設定。目前只存掛號完成時建立草稿所用的預設表單；
// 獨立成單一文件，避免把「哪份表單是預設」散落在每一份 FormTemplate 上。
const clinicSettingsSchema = new mongoose.Schema(
  {
    defaultAppointmentTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: 'FormTemplate', default: null },
  },
  { timestamps: true }
);

export default mongoose.model('ClinicSettings', clinicSettingsSchema);
