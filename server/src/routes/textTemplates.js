import { Router } from 'express';
import TextTemplate from '../models/TextTemplate.js';
import QuickPhrase from '../models/QuickPhrase.js';
import FormTemplate from '../models/FormTemplate.js';
import { escapeRegExp } from '../lib/regex.js';

const router = Router();
const TEXT_TEMPLATE_ITEM_TYPES = new Set(['text', 'textarea', 'finding', 'lab']);

function cleanItemKeys(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => String(entry ?? '').trim()).filter(Boolean))].slice(0, 100);
}

function legacyName(text) {
  const firstLine = String(text ?? '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '舊常用語';
  return firstLine.length > 28 ? `${firstLine.slice(0, 28)}…` : firstLine;
}

// 現有診所資料不能因功能升級而消失。第一次讀取模板時，將舊常用語逐筆轉成
// 有名稱、且仍套用於原欄位的文字模板；legacyQuickPhraseId 讓這個動作可安全重跑。
export async function migrateLegacyQuickPhrases() {
  const legacy = await QuickPhrase.find({ migratedAt: null }).select('+migratedAt').lean();
  if (!legacy.length) return;
  await TextTemplate.bulkWrite(legacy.map((phrase) => ({
    updateOne: {
      filter: { legacyQuickPhraseId: phrase._id },
      update: {
        $setOnInsert: {
          name: legacyName(phrase.text),
          content: phrase.text,
          availableForAllFields: false,
          applicableItemKeys: [phrase.itemKey],
          enabled: true,
          usageCount: phrase.usageCount ?? 0,
          legacyQuickPhraseId: phrase._id,
        },
      },
      upsert: true,
    },
  })), { ordered: false });
  await QuickPhrase.updateMany(
    { _id: { $in: legacy.map((phrase) => phrase._id) }, migratedAt: null },
    { $set: { migratedAt: new Date() } }
  );
}

function readPayload(body) {
  const name = String(body?.name ?? '').trim();
  const content = String(body?.content ?? '').trim();
  const availableForAllFields = body?.availableForAllFields === true;
  const applicableItemKeys = availableForAllFields ? [] : cleanItemKeys(body?.applicableItemKeys);
  return {
    name,
    content,
    availableForAllFields,
    applicableItemKeys,
    enabled: body?.enabled !== false,
  };
}

function validationMessage(payload) {
  if (!payload.name) return '請填寫模板名稱';
  if (payload.name.length > 80) return '模板名稱請控制在 80 字以內';
  if (!payload.content) return '請填寫模板內容';
  if (payload.content.length > 2000) return '模板內容請控制在 2,000 字以內';
  if (!payload.availableForAllFields && !payload.applicableItemKeys.length) return '請選擇至少一個適用欄位，或設為所有文字欄位皆可使用';
  return '';
}

router.get('/fields', async (req, res, next) => {
  try {
    const formTemplates = await FormTemplate.find().select('name sections').sort({ order: 1, name: 1 }).lean();
    const fields = new Map();
    formTemplates.forEach((formTemplate) => {
      (formTemplate.sections ?? []).forEach((section) => {
        (section.items ?? []).forEach((item) => {
          if (!item.key || !TEXT_TEMPLATE_ITEM_TYPES.has(item.type)) return;
          const label = item.type === 'finding' || item.type === 'lab' ? `${item.label || '未命名欄位'}備註` : (item.label || '未命名欄位');
          const existing = fields.get(item.key) ?? {
            key: item.key,
            label,
            role: item.role ?? null,
            forms: [],
          };
          if (!existing.forms.includes(formTemplate.name)) existing.forms.push(formTemplate.name);
          fields.set(item.key, existing);
          if (item.type === 'lab') {
            const valueKey = `${item.key}:value`;
            const valueField = fields.get(valueKey) ?? {
              key: valueKey,
              label: `${item.label || '未命名欄位'}結果描述`,
              role: item.role ?? null,
              forms: [],
            };
            if (!valueField.forms.includes(formTemplate.name)) valueField.forms.push(formTemplate.name);
            fields.set(valueKey, valueField);
          }
        });
      });
    });
    res.json([...fields.values()].sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant')));
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    await migrateLegacyQuickPhrases();
    const includeDisabled = req.query.includeDisabled === '1' || req.query.includeDisabled === 'true';
    const query = String(req.query.q ?? '').trim();
    const filter = includeDisabled ? {} : { enabled: true };
    if (query) {
      const keyword = new RegExp(escapeRegExp(query), 'i');
      filter.$or = [{ name: keyword }, { content: keyword }];
    }
    const templates = await TextTemplate.find(filter).select('-category').sort({ usageCount: -1, updatedAt: -1 });
    res.json(templates);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const payload = readPayload(req.body);
    const error = validationMessage(payload);
    if (error) return res.status(422).json({ message: error });
    const template = await TextTemplate.create(payload);
    res.status(201).json(template);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const payload = readPayload(req.body);
    const error = validationMessage(payload);
    if (error) return res.status(422).json({ message: error });
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return res.status(428).json({ message: '缺少模板版本資訊，請重新整理後再試' });
    }
    const template = await TextTemplate.findOneAndUpdate(
      { _id: req.params.id, __v: expectedVersion },
      { $set: payload, $unset: { category: 1 }, $inc: { __v: 1 } },
      { new: true, runValidators: true }
    ).select('-category');
    if (!template) {
      const current = await TextTemplate.findById(req.params.id).select('__v');
      if (!current) return res.status(404).json({ message: '找不到文字模板' });
      return res.status(409).json({ message: '模板已在其他分頁被修改，請重新整理後再試' });
    }
    res.json(template);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/use', async (req, res, next) => {
  try {
    const template = await TextTemplate.findByIdAndUpdate(req.params.id, { $inc: { usageCount: 1 } }, { new: true }).select('-category');
    if (!template) return res.status(404).json({ message: '找不到文字模板' });
    res.json(template);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const template = await TextTemplate.findByIdAndDelete(req.params.id);
    if (!template) return res.status(404).json({ message: '找不到文字模板' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
