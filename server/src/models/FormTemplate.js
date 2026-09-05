import mongoose from 'mongoose';

// 表單項目的欄位型別，決定表單控制項與報告呈現方式。
export const ITEM_TYPES = ['text', 'textarea', 'date', 'number', 'select', 'radio', 'checkbox', 'image', 'measurement', 'finding', 'lab', 'dentalChart'];

// 語意角色：讓後端不必寫死欄位名稱也能找到特定資料（例如結案時要同步的體重）。
// 帶 role 的項目可以停用或搬到別的區塊，但刪除前要提醒使用者會失去對應功能。
// examType 不再是表單裡的欄位 —— 健檢類型就是「用哪一份範本」，見下方 name。
export const ITEM_ROLES = ['vet', 'visitDate', 'weight', 'conclusion', 'treatmentPlan'];

// 區塊在報告檢視頁的版式。版式是有限集合，由我們維護列印效果，
// 使用者新增區塊時只從這裡挑一種，報告才不會退化成流水帳。
export const PRESENTATIONS = ['keyValue', 'grid', 'findings', 'table', 'prose'];

const formItemSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    type: { type: String, enum: ITEM_TYPES, required: true },
    role: { type: String, enum: ITEM_ROLES, default: null },
    group: { type: String, default: '', trim: true },
    unit: { type: String, default: '', trim: true },
    placeholder: { type: String, default: '', trim: true },
    defaultValue: { type: String, default: '', trim: true },
    options: { type: [String], default: [] },
    // 網格版式裡這個欄位要佔多寬：auto 跟著版式、wide 兩格、full 整排。
    span: { type: String, enum: ['auto', 'wide', 'full'], default: 'auto' },
    order: { type: Number, default: 0 },
    enabled: { type: Boolean, default: true },
    required: { type: Boolean, default: false },
    numeric: { type: Boolean, default: true },
    rows: { type: Number, default: null },
    // min／max／step 是輸入框的限制（例如體態評分只能 1–9）。
    min: { type: Number, default: null },
    max: { type: Number, default: null },
    step: { type: Number, default: null },
    // 參考範圍：填表時據此自動判讀正常／異常。屬於這份表單的這個項目，
    // 所以複製表單時會一起複製，改 A 表單不影響 B 表單。
    referenceMin: { type: Number, default: null },
    referenceMax: { type: Number, default: null },
  },
  { _id: false }
);

const formSectionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    // 報告上的標題，留空就沿用 title。
    // 有些區塊在表單與報告上的稱呼本來就不同（例如基本資料的醫師／日期會提到報告頁首，
    // 報告上剩下的內容其實是「主訴與病史」）。
    reportTitle: { type: String, default: '', trim: true },
    description: { type: String, default: '', trim: true },
    presentation: { type: String, enum: PRESENTATIONS, default: 'keyValue' },
    order: { type: Number, default: 0 },
    enabled: { type: Boolean, default: true },
    items: { type: [formItemSchema], default: [] },
  },
  { _id: false }
);

const formTemplateSchema = new mongoose.Schema(
  {
    // 一份範本就是一種健檢類型，name 會顯示在建立報告的類型選單與報告頁首。
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    // 這份表單給哪種動物用。'all' = 不限，建立報告時一律可選；
    // 指定物種後，只有該物種的寵物會看到這份表單。
    species: { type: String, enum: ['cat', 'dog', 'all'], default: 'all' },
    // 停用的類型不再出現在建立報告的選單，但既有報告仍能正常顯示。
    enabled: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    version: { type: Number, min: 1, default: 1 },
    sections: { type: [formSectionSchema], default: [] },
    // 已刪除過的 key 不再重複使用，避免新項目繼承到舊項目的歷史語意。
    retiredKeys: { type: [String], default: [] },
    relationVersion: { type: Number, default: 0, select: false },
  },
  { timestamps: true, optimisticConcurrency: true }
);

// 類型名稱要能一眼分辨，不允許重複。
formTemplateSchema.index({ name: 1 }, { unique: true });

export default mongoose.model('FormTemplate', formTemplateSchema);
