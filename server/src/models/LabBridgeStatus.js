import mongoose from 'mongoose';

// 診所電腦上 IDEXX 抓檔程式的心跳（見 docs/IDEXX_INTERLINK.md）。它在背景跑、沒有視窗，
// 開發者人又不在診所——停了沒人會發現，所以它每分鐘回報一次，這裡只留每台最新的一筆。
const labBridgeStatusSchema = new mongoose.Schema(
  {
    // 設定檔的 name，沒填就是電腦名稱；一台電腦一筆。
    bridgeId: { type: String, required: true },
    hostname: { type: String, default: '' },
    version: { type: String, default: '' },
    resultsDir: { type: String, default: '' },
    startedAt: { type: Date, default: null },
    lastSeenAt: { type: Date, required: true },
    lastUploadAt: { type: Date, default: null },
    // 還留在資料夾裡、沒上傳成功的 XML 數量；一直不歸零代表有檔案卡住。
    pendingFiles: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
  },
  { timestamps: false }
);
labBridgeStatusSchema.index({ bridgeId: 1 }, { unique: true });

export default mongoose.model('LabBridgeStatus', labBridgeStatusSchema);
