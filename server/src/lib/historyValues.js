import mongoose from 'mongoose';
import MedicalRecord from '../models/MedicalRecord.js';

export const HISTORY_ITEM_TYPES = new Set(['lab', 'measurement', 'number']);
export const HISTORY_RECORD_LIMIT = 20;

export async function excludedHistoryIds(recordId) {
  if (!recordId || !mongoose.isValidObjectId(recordId)) return [];
  const current = await MedicalRecord.findById(recordId).select('revisionRootId revisionOf');
  const rootId = current?.revisionRootId || current?.revisionOf;
  if (!rootId) return [recordId];
  const family = await MedicalRecord.find({ $or: [{ _id: rootId }, { revisionRootId: rootId }] }).select('_id');
  return [recordId, ...family.map((doc) => doc._id)];
}

export function historyEntry(record, item) {
  return {
    key: item.key,
    label: item.label,
    type: item.type,
    value: item.value,
    unit: item.unit ?? '',
    status: item.status ?? null,
    note: item.note ?? '',
    visitDate: record.visitDate,
    examType: record.examType,
    recordId: record._id,
  };
}

export async function getPetPreviousValues(petId, excludeRecordId = null, historyBoundary = null) {
  const targetPetId = typeof petId === 'object' && petId?._id ? petId._id : petId;
  if (!targetPetId || !mongoose.isValidObjectId(targetPetId)) return { byKey: {}, byLabel: {} };
  const boundaryVisitDate = historyBoundary?.visitDate ?? historyBoundary;
  const before = boundaryVisitDate ? new Date(boundaryVisitDate) : null;
  const boundaryFinalizedAt = historyBoundary?.finalizedAt ? new Date(historyBoundary.finalizedAt) : null;
  const filter = {
    petId: targetPetId,
    status: { $ne: 'draft' },
    supersededBy: null,
    _id: { $nin: await excludedHistoryIds(excludeRecordId) },
  };
  // Reports often use a date-only visitDate, so include earlier reports from
  // the same day. Once a report is finalized, its finalization time breaks
  // that tie and prevents later reports from appearing as its history.
  if (before && !Number.isNaN(before.getTime())) {
    const sameDay = { visitDate: before };
    if (boundaryFinalizedAt && !Number.isNaN(boundaryFinalizedAt.getTime())) {
      sameDay.finalizedAt = { $lt: boundaryFinalizedAt };
    }
    filter.$or = [{ visitDate: { $lt: before } }, sameDay];
  }

  const records = await MedicalRecord.find(filter)
    .sort({ visitDate: -1, finalizedAt: -1, reportVersion: -1 })
    .limit(HISTORY_RECORD_LIMIT)
    .select('sections visitDate examType');

  const byKey = {};
  const byLabel = {};
  for (const record of records) {
    for (const item of (record.sections ?? []).flatMap((section) => section.items ?? [])) {
      if (!HISTORY_ITEM_TYPES.has(item.type) || String(item.value ?? '').trim() === '') continue;
      const entry = historyEntry(record, item);
      if (!byKey[item.key]) byKey[item.key] = entry;
      const labelKey = `${item.type}:${String(item.label ?? '').trim()}`;
      if (!byLabel[labelKey]) byLabel[labelKey] = entry;
    }
  }
  return { byKey, byLabel };
}

export function enrichSectionsWithPreviousValues(sections, previousValues) {
  if (!Array.isArray(sections) || !previousValues) return sections ?? [];
  const { byKey = {}, byLabel = {} } = previousValues;

  return sections.map((section) => {
    // `record.sections` contains Mongoose subdocuments after a report is read
    // from the database. Spreading one exposes Mongoose internals instead of
    // the section fields, so normalize it before constructing the API payload.
    const sectionData = section?.toObject?.() ?? section;

    return {
      ...sectionData,
      items: (sectionData.items ?? []).map((item) => {
        const itemData = item?.toObject?.() ?? item;
      // 已經存在上次數值快照的直接保留
        if (itemData.previousValue !== undefined) return itemData;
        if (!HISTORY_ITEM_TYPES.has(itemData.type)) return itemData;

        const labelKey = `${itemData.type}:${String(itemData.label ?? '').trim()}`;
        const prev = byKey[itemData.key] ?? (itemData.label ? byLabel[labelKey] : null);

        if (!prev || prev.value == null || String(prev.value).trim() === '') return itemData;

        return {
          ...itemData,
          previousValue: prev.value,
          previousUnit: prev.unit ?? '',
          previousStatus: prev.status ?? null,
          previousVisitDate: prev.visitDate ?? null,
        };
      }),
    };
  });
}
