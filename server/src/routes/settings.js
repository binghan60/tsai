import { Router } from 'express';
import mongoose from 'mongoose';
import FormTemplate from '../models/FormTemplate.js';
import MedicalRecord from '../models/MedicalRecord.js';
import { buildDefaultSections } from '../config/formTemplateSeed.js';
import {
  listTemplates, missingRoles, sanitizeSections, serializeTemplate, serializeTemplateSummary,
} from '../lib/formTemplate.js';
import { withTransaction } from '../lib/transaction.js';

const router = Router();
const VALID_SPECIES = new Set(['cat', 'dog', 'all']);
const START_MODES = new Set(['standard', 'blank', 'copy']);

const ROLE_LABELS = {
  vet: '看診醫師', visitDate: '健檢日期', weight: '體重',
  conclusion: '結論', treatmentPlan: '照護與追蹤建議',
};

// 健檢類型清單。一份範本 = 一種健檢類型。
router.get('/form-templates', async (req, res, next) => {
  try {
    const includeDisabled = req.query.includeDisabled === '1' || req.query.includeDisabled === 'true';
    // 建立報告時帶寵物物種，只會拿到適用的表單。
    const templates = await listTemplates({ includeDisabled, species: req.query.species || undefined });
    res.json(templates.map(serializeTemplateSummary));
  } catch (err) {
    next(err);
  }
});

// 新增健檢類型。起始內容有三種：標準結構、完全空白、複製現有表單。
router.post('/form-templates', async (req, res, next) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(422).json({ message: '請填寫健檢類型名稱' });
    if (await FormTemplate.exists({ name })) return res.status(409).json({ message: `「${name}」已經存在` });

    // start 決定起始內容；沒帶就看有沒有 copyFrom，都沒有就是標準結構。
    const start = String(req.body?.start ?? (req.body?.copyFrom ? 'copy' : 'standard'));
    if (!START_MODES.has(start)) return res.status(422).json({ message: '起始內容選項不正確' });

    let source = null;
    if (start === 'copy') {
      // 選了複製卻找不到來源就要明確報錯。悄悄退回標準結構的話，
      // 使用者以為複製到了，實際拿到一份完全不同的表單。
      if (!mongoose.isValidObjectId(req.body?.copyFrom)) {
        return res.status(422).json({ message: '請選擇要複製的表單' });
      }
      source = await FormTemplate.findById(req.body.copyFrom);
      if (!source) return res.status(422).json({ message: '找不到要複製的表單' });
    }
    const order = await FormTemplate.countDocuments();

    // 空白表單就是沒有任何區塊，編輯頁有對應的空狀態引導使用者加第一個區塊。
    // 複製前一律清洗一次，順便重新編號 order。
    // 傳入 source 當作既有結構，key 才會原封不動沿用（同一個 key 在不同表單代表同一件事）。
    let sections = start === 'blank' ? [] : buildDefaultSections();
    if (source) {
      const cleaned = sanitizeSections(source.toObject().sections, source);
      if (cleaned.error) return res.status(422).json({ message: `來源表單結構有問題：${cleaned.error}` });
      sections = cleaned.sections;
    }

    const template = await FormTemplate.create({
      name,
      description: String(req.body?.description ?? '').trim(),
      species: VALID_SPECIES.has(req.body?.species) ? req.body.species : (source?.species ?? 'all'),
      enabled: true,
      order,
      version: 1,
      sections,
    });
    res.status(201).json(serializeTemplate(template, { includeDisabled: true }));
  } catch (err) {
    next(err);
  }
});

router.get('/form-templates/:id', async (req, res, next) => {
  try {
    const includeDisabled = req.query.includeDisabled === '1' || req.query.includeDisabled === 'true';
    const template = await FormTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ message: '找不到這個健檢類型' });
    res.json(serializeTemplate(template, { includeDisabled }));
  } catch (err) {
    next(err);
  }
});

// 儲存範本內容與類型設定。key 一律由後端決定，前端送什麼 key 都不能改動既有項目的識別碼。
router.put('/form-templates/:id', async (req, res, next) => {
  try {
    const template = await FormTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ message: '找不到這個健檢類型' });
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return res.status(428).json({ message: '缺少表單版本資訊，請重新整理後再儲存' });
    }
    if (template.__v !== expectedVersion) {
      return res.status(409).json({ message: '這份表單已在其他分頁被更新，請重新整理後再編輯' });
    }

    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(422).json({ message: '請填寫健檢類型名稱' });
      if (await FormTemplate.exists({ name, _id: { $ne: template._id } })) {
        return res.status(409).json({ message: `「${name}」已經存在` });
      }
      template.name = name;
    }
    if (req.body?.description !== undefined) template.description = String(req.body.description).trim();
    if (req.body?.species !== undefined && VALID_SPECIES.has(req.body.species)) template.species = req.body.species;
    if (req.body?.enabled !== undefined) template.enabled = req.body.enabled !== false;

    if (Array.isArray(req.body?.sections)) {
      const { sections, retiredKeys, error } = sanitizeSections(req.body.sections, template);
      if (error) return res.status(422).json({ message: error });

      // 帶 role 的項目被刪掉會讓體重同步、結案驗證等功能失效，需要明確確認。
      const lost = missingRoles(sections, template);
      if (lost.length && req.body.confirmRoleRemoval !== true) {
        return res.status(409).json({
          message: `移除「${lost.map((role) => ROLE_LABELS[role] ?? role).join('、')}」會讓對應功能失效，請確認後再儲存`,
          missingRoles: lost,
        });
      }
      template.sections = sections;
      template.retiredKeys = retiredKeys;
      template.version += 1;
    }

    await template.save();
    res.json(serializeTemplate(template, { includeDisabled: true }));
  } catch (err) {
    next(err);
  }
});

// 刪除健檢類型。已有報告引用時只能停用，否則那些報告會失去自己的表單結構。
router.delete('/form-templates/:id', async (req, res, next) => {
  try {
    await withTransaction(async (session) => {
      const template = await FormTemplate.findById(req.params.id).session(session);
      if (!template) {
        const error = new Error('找不到這個健檢類型');
        error.status = 404;
        throw error;
      }

      // 所有刪除都寫入同一份排序最前的範本，避免兩個 transaction 同時各刪一份，
      // 都看到「尚有兩份」後一起提交，最後違反至少保留一份的規則。
      await FormTemplate.findOneAndUpdate(
        {},
        { $inc: { relationVersion: 1 } },
        { sort: { _id: 1 }, session }
      ).select('+relationVersion');

      // 已結案報告雖然有自己的 sections 快照，但對它建修訂草稿時會沿用 templateId，
      // 範本被刪掉那份草稿就再也結不了案。只要有報告引用就不能刪，改用停用。
      const inUse = await MedicalRecord.countDocuments({ templateId: template._id }).session(session);
      if (inUse) {
        const error = new Error(`還有 ${inUse} 份報告正在使用「${template.name}」，請改為停用這個類型`);
        error.status = 409;
        throw error;
      }
      if (await FormTemplate.countDocuments().session(session) <= 1) {
        const error = new Error('至少要保留一種健檢類型');
        error.status = 409;
        throw error;
      }

      const deleted = await FormTemplate.deleteOne({ _id: template._id }, { session });
      if (deleted.deletedCount !== 1) {
        const error = new Error('表單正在被其他操作使用，請重新整理後再試');
        error.status = 409;
        throw error;
      }
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});


export default router;
