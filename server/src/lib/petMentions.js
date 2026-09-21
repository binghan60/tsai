import mongoose from 'mongoose';
import Pet from '../models/Pet.js';
import { MAX_MENTIONS } from './pinnedPets.js';

// 聊天訊息與院內待辦共用：內文裡用 # 標記的寵物。前端只送 petId，
// 名字快照由伺服器查寵物文件寫入，不採信前端送來的文字。

// 未帶（undefined）視為沒有標記；格式不對（不是陣列、超過上限、含非法 id）回 null，
// 由呼叫端決定錯誤訊息。回傳去重後的 id 字串陣列。
export function parseMentionIds(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_MENTIONS || !value.every((id) => mongoose.isValidObjectId(id))) return null;
  return [...new Set(value.map(String))];
}

// 依 id 順序回傳 [{ petId, petName, ownerName }]；只要有一隻不存在就回 null。
export async function mentionSnapshots(petIds) {
  if (!petIds.length) return [];
  const pets = await Pet.find({ _id: { $in: petIds } }).select('name ownerId').populate('ownerId', 'name').lean();
  if (pets.length !== petIds.length) return null;
  const petById = new Map(pets.map((pet) => [String(pet._id), pet]));
  return petIds.map((id) => {
    const pet = petById.get(id);
    return { petId: pet._id, petName: pet.name, ownerName: pet.ownerId?.name ?? '' };
  });
}
