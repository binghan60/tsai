// 舊系統資料遷移，階段 B（見 server/scripts/legacy-migration/README.md）。
//
// 用法：
//   node scripts/legacy-migration/import-legacy-pets.js --dry-run <jsonl路徑>   # 只統計，不寫入
//   node scripts/legacy-migration/import-legacy-pets.js <jsonl路徑>             # 正式匯入
//
// 冪等：用 legacyMedicalRecordNumber 判斷是否已匯入過，可安全重跑。
import 'dotenv/config';
import fs from 'node:fs';
import readline from 'node:readline';
import mongoose from 'mongoose';
import Owner from '../../src/models/Owner.js';
import Pet from '../../src/models/Pet.js';
import ClinicalNote from '../../src/models/ClinicalNote.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const filePath = args.find((arg) => !arg.startsWith('--'));

if (!filePath) {
  console.error('Usage: node scripts/legacy-migration/import-legacy-pets.js [--dry-run] <jsonl路徑>');
  process.exit(1);
}
if (!fs.existsSync(filePath)) {
  console.error(`找不到檔案：${filePath}`);
  process.exit(1);
}

// 只保留數字，讓 "02-1234567"、"0912 345 678" 這類格式不同但代表同一組號碼的資料
// 正規化成同一個比對鍵。不處理「缺區碼」這種語意層級的判斷——那種情況保守起見
// 仍當成不同飼主，總比錯誤合併兩個不同人的資料好。
function normalizePhone(value) {
  return String(value ?? '').replace(/[^0-9]/g, '');
}

const SEX_MAP = { male: 'male', female: 'female' };
function mapSex(value) {
  const key = String(value ?? '').trim().toLowerCase();
  return SEX_MAP[key] ?? 'unknown';
}

function mapNeutered(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return 'unknown';
  if (text.includes('intact')) return 'no';
  if (text.includes('neuter') || text.includes('spay')) return 'yes';
  return 'unknown';
}

function parseWeight(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function parseBirthDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function readRows(path) {
  const rows = [];
  const stream = fs.createReadStream(path, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rows.push(JSON.parse(trimmed));
  }
  return rows;
}

async function runDryRun(rows) {
  const total = rows.length;
  let missingPhone = 0;
  let missingOwnerName = 0;
  let duplicateLegacyId = 0;
  let notesCount = 0;
  let notesTotalLength = 0;
  let notesMaxLength = 0;
  const phones = new Set();
  const seenLegacyIds = new Set();

  for (const row of rows) {
    const phone = normalizePhone(row.phone) || normalizePhone(row.mobilePhone);
    if (!phone) missingPhone++;
    else phones.add(phone);
    if (!String(row.ownerName ?? '').trim()) missingOwnerName++;
    const legacyId = String(row.legacyMedicalRecordNumber ?? '').trim();
    if (legacyId) {
      if (seenLegacyIds.has(legacyId)) duplicateLegacyId++;
      seenLegacyIds.add(legacyId);
    }
    const notes = String(row.chartNotes ?? '').trim();
    if (notes) {
      notesCount++;
      notesTotalLength += notes.length;
      notesMaxLength = Math.max(notesMaxLength, notes.length);
    }
  }

  const alreadyImported = await Pet.countDocuments({ legacyMedicalRecordNumber: { $in: [...seenLegacyIds] } });

  console.log('--- 匯入統計（未寫入任何資料）---');
  console.log(`總筆數：${total}`);
  console.log(`缺電話（phone 與 mobilePhone 皆空，將被跳過）：${missingPhone}`);
  console.log(`缺飼主姓名：${missingOwnerName}`);
  console.log(`依電話去重後的飼主數：${phones.size}`);
  console.log(`檔案內 legacyMedicalRecordNumber 重複筆數：${duplicateLegacyId}`);
  console.log(`資料庫裡已存在（重跑會跳過）：${alreadyImported}`);
  console.log(`含病歷全文的筆數：${notesCount}，平均長度：${notesCount ? Math.round(notesTotalLength / notesCount) : 0} 字，最長：${notesMaxLength} 字`);
}

async function runImport(rows) {
  const skippedLog = fs.createWriteStream(`${filePath}.skipped-rows.log`, { flags: 'w' });
  const errorLog = fs.createWriteStream(`${filePath}.errors.log`, { flags: 'w' });
  const ownerCache = new Map(); // phone -> ownerId

  let imported = 0;
  let skippedExisting = 0;
  let skippedNoIdentity = 0;
  let backfilled = 0;
  let failed = 0;
  let processed = 0;

  for (const row of rows) {
    processed++;
    try {
      const legacyId = String(row.legacyMedicalRecordNumber ?? '').trim();
      const chartNotes = String(row.chartNotes ?? '').trim();

      if (legacyId) {
        const existingPet = await Pet.findOne({ legacyMedicalRecordNumber: legacyId }).select('_id');
        if (existingPet) {
          // 寵物已經匯過，但可能是上次執行中途中斷、只建立了 Pet 沒建立到日誌記事——
          // 補上缺的那一步，而不是整筆跳過，這樣重跑才能真正把中斷的匯入補完整。
          if (chartNotes && !(await ClinicalNote.exists({ petId: existingPet._id, source: 'legacy_import' }))) {
            await ClinicalNote.create({
              petId: existingPet._id,
              source: 'legacy_import',
              entryDate: new Date(),
              content: `【舊系統病歷匯入，內容為歷年看診筆記全文】\n${chartNotes}`,
            });
            backfilled++;
          } else {
            skippedExisting++;
          }
          continue;
        }
      }

      const phone = normalizePhone(row.phone) || normalizePhone(row.mobilePhone);
      const ownerName = String(row.ownerName ?? '').trim();
      if (!phone) {
        skippedNoIdentity++;
        skippedLog.write(`${legacyId || '(無舊病歷號)'}\t${ownerName || '(無飼主姓名)'}\t缺電話，無法建立飼主\n`);
        continue;
      }

      let ownerId = ownerCache.get(phone);
      if (!ownerId) {
        const owner = await Owner.findOneAndUpdate(
          { phone },
          { $setOnInsert: { name: ownerName || phone, phone, email: String(row.email ?? '').trim() } },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        ownerId = owner._id;
        ownerCache.set(phone, ownerId);
      }

      const pet = await Pet.create({
        name: String(row.petName ?? '').trim() || '未命名',
        ownerId,
        legacyMedicalRecordNumber: legacyId || null,
        species: String(row.species ?? '').trim(),
        breed: String(row.breed ?? '').trim(),
        sex: mapSex(row.sex),
        neutered: mapNeutered(row.neutered),
        birthDate: parseBirthDate(row.birthDate),
        weightKg: parseWeight(row.weightKg),
      });

      if (chartNotes) {
        await ClinicalNote.create({
          petId: pet._id,
          source: 'legacy_import',
          entryDate: new Date(),
          content: `【舊系統病歷匯入，內容為歷年看診筆記全文】\n${chartNotes}`,
        });
      }

      imported++;
    } catch (err) {
      failed++;
      errorLog.write(`第 ${processed} 筆（legacyMedicalRecordNumber=${row.legacyMedicalRecordNumber}）：${err.message}\n`);
    }
    if (processed % 500 === 0) console.log(`進度：${processed}/${rows.length}`);
  }

  skippedLog.end();
  errorLog.end();
  console.log('--- 匯入完成 ---');
  console.log(`成功：${imported}，已存在跳過：${skippedExisting}，補建缺漏日誌：${backfilled}，缺身分跳過：${skippedNoIdentity}，失敗：${failed}`);
  if (skippedNoIdentity) console.log(`缺身分的清單見 ${filePath}.skipped-rows.log`);
  if (failed) console.log(`錯誤清單見 ${filePath}.errors.log`);
  return failed;
}

const rows = await readRows(filePath);
await mongoose.connect(process.env.MONGODB_URI);

let failed = 0;
if (dryRun) {
  await runDryRun(rows);
} else {
  failed = await runImport(rows);
}

await mongoose.disconnect();
process.exit(failed > 0 ? 1 : 0);
