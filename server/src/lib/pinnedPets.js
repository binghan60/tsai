import PinnedPet from '../models/PinnedPet.js';
import { emitPinnedPetsUpdate } from './realtime.js';

export const STAFF_SENDERS = ['vet', 'front_desk'];
export const MAX_MENTIONS = 5;

// 暫存區筆數很少，異動後一律整份重讀並廣播，前端直接取代，不處理差異合併。
export async function listPinnedPets() {
  const rows = await PinnedPet.find()
    .sort({ pinnedAt: -1, _id: -1 })
    .populate({ path: 'petId', select: 'name species breed medicalRecordNumber ownerId', populate: { path: 'ownerId', select: 'name phone' } })
    .lean();
  // 寵物已經不存在的殘留紀錄不回給前端，點開也只會是 404。
  return rows.filter((row) => row.petId).map((row) => {
    const { petId: pet, ...rest } = row;
    const { ownerId: owner, ...petFields } = pet;
    return { ...rest, petId: pet._id, pet: { ...petFields, owner: owner ?? null } };
  });
}

export async function upsertPinnedPets(petIds, { pinnedBy, source, messageId = null, session } = {}) {
  if (!petIds.length) return;
  const pinnedAt = new Date();
  await PinnedPet.bulkWrite(
    petIds.map((petId) => ({
      updateOne: {
        filter: { petId },
        update: { $set: { pinnedBy, source, messageId, pinnedAt } },
        upsert: true,
      },
    })),
    { session }
  );
}

// 重讀清單、廣播給所有裝置，並把同一份清單回給呼叫端當 HTTP 回應。
export async function publishPinnedPets() {
  const items = await listPinnedPets();
  emitPinnedPetsUpdate(items);
  return items;
}
