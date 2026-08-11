import { Router } from 'express';
import LabReferenceRange from '../models/LabReferenceRange.js';
import { REFERENCE_METRIC_DEFINITIONS, REFERENCE_METRIC_MAP, normalizeSpecies } from '../config/labTests.js';

const router = Router();
const VALID_SPECIES = new Set(['cat', 'dog', 'all']);

function parseNullableNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function serializeRanges(species, records, effective) {
  const byKeyAndSpecies = new Map(records.map((item) => [`${item.key}:${item.species}`, item]));
  return REFERENCE_METRIC_DEFINITIONS.map((definition) => {
    const selected = byKeyAndSpecies.get(`${definition.key}:${species}`) || (effective ? byKeyAndSpecies.get(`${definition.key}:all`) : null);
    return {
      ...definition,
      species,
      unit: selected?.unit ?? definition.unit ?? '',
      min: selected?.min ?? null,
      max: selected?.max ?? null,
      enabled: selected?.enabled ?? true,
      configured: Boolean(selected && (selected.min != null || selected.max != null)),
      sourceSpecies: selected?.species ?? null,
    };
  });
}

router.get('/lab-ranges', async (req, res, next) => {
  try {
    const requestedSpecies = String(req.query.species ?? 'all');
    const species = VALID_SPECIES.has(requestedSpecies) ? requestedSpecies : normalizeSpecies(requestedSpecies);
    const effective = req.query.effective === '1' || req.query.effective === 'true';
    const speciesFilter = effective && species !== 'all' ? { $in: [species, 'all'] } : species;
    const records = await LabReferenceRange.find({ species: speciesFilter });
    res.json({ species, ranges: serializeRanges(species, records, effective) });
  } catch (err) {
    next(err);
  }
});

router.put('/lab-ranges', async (req, res, next) => {
  try {
    const species = String(req.body?.species ?? '');
    if (!VALID_SPECIES.has(species)) return res.status(422).json({ message: '無效的物種設定' });
    if (!Array.isArray(req.body?.ranges)) return res.status(422).json({ message: '標準值格式錯誤' });

    const updates = [];
    for (const item of req.body.ranges) {
      if (!REFERENCE_METRIC_MAP.has(item.key)) continue;
      const min = parseNullableNumber(item.min);
      const max = parseNullableNumber(item.max);
      if (Number.isNaN(min) || Number.isNaN(max)) return res.status(422).json({ message: `${REFERENCE_METRIC_MAP.get(item.key).label} 的上下限必須是數字` });
      if (min != null && max != null && min > max) return res.status(422).json({ message: `${REFERENCE_METRIC_MAP.get(item.key).label} 的下限不可大於上限` });
      updates.push({
        updateOne: {
          filter: { key: item.key, species },
          update: { $set: { unit: String(item.unit ?? '').trim(), min, max, enabled: item.enabled !== false } },
          upsert: true,
        },
      });
    }
    if (updates.length) await LabReferenceRange.bulkWrite(updates);
    const records = await LabReferenceRange.find({ species });
    res.json({ species, ranges: serializeRanges(species, records, false) });
  } catch (err) {
    next(err);
  }
});

export default router;
