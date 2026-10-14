import Drug from '../models/Drug.js';
import DrugGroup from '../models/DrugGroup.js';
import { withTransaction } from './transaction.js';
import { planDrugMove, sortByDrugOrder } from '../../../shared/drugOrder.js';

// 把藥品移到 groupId 分類（null＝未分類）的 beforeId 前面（null＝最後），該分類依新順序編號 0、1、2…，
// 只寫有變的幾筆。回傳 'ok'；'missing' 是藥品或目標分類已經不存在；'stale' 是 beforeId 已經不在目標分類
// （另一台剛搬走或刪掉），呼叫端回 409 讓前端重讀，不照過時的畫面硬排。
export async function moveDrug(id, { groupId = null, beforeId = null } = {}) {
  return withTransaction(async (session) => {
    const drug = await Drug.findById(id).select('_id groupId').session(session).lean();
    if (!drug) return 'missing';
    if (groupId && !(await DrugGroup.exists({ _id: groupId }).session(session))) return 'missing';
    const rows = sortByDrugOrder(
      await Drug.find({ groupId: groupId ?? null }).select('_id sortOrder createdAt').session(session).lean()
    );
    const ids = planDrugMove(rows.map((row) => row._id), id, beforeId);
    if (!ids) return 'stale';
    const current = new Map(rows.map((row) => [String(row._id), row.sortOrder]));
    const operations = ids
      .map((drugId, index) => ({ drugId, index }))
      .filter(({ drugId, index }) => drugId === String(id) || current.get(drugId) !== index)
      .map(({ drugId, index }) => ({
        updateOne: {
          filter: { _id: drugId },
          update: { $set: drugId === String(id) ? { sortOrder: index, groupId: groupId ?? null } : { sortOrder: index } },
        },
      }));
    if (operations.length) await Drug.bulkWrite(operations, { session });
    return 'ok';
  });
}

// 分類之間的順序。規則同 moveDrug。
export async function moveDrugGroup(id, beforeId = null) {
  return withTransaction(async (session) => {
    const rows = sortByDrugOrder(await DrugGroup.find().select('_id sortOrder createdAt').session(session).lean());
    if (!rows.some((row) => String(row._id) === String(id))) return 'missing';
    const ids = planDrugMove(rows.map((row) => row._id), id, beforeId);
    if (!ids) return 'stale';
    const current = new Map(rows.map((row) => [String(row._id), row.sortOrder]));
    const operations = ids
      .map((groupId, index) => ({ groupId, index }))
      .filter(({ groupId, index }) => current.get(groupId) !== index)
      .map(({ groupId, index }) => ({ updateOne: { filter: { _id: groupId }, update: { $set: { sortOrder: index } } } }));
    if (operations.length) await DrugGroup.bulkWrite(operations, { session });
    return 'ok';
  });
}

// 刪除分類：組內藥品一起移到未分類（接在未分類的最後），同一個 transaction。
export async function deleteDrugGroup(id) {
  return withTransaction(async (session) => {
    const group = await DrugGroup.findByIdAndDelete(id).session(session);
    if (!group) return false;
    const last = await Drug.find({ groupId: null }).select('sortOrder createdAt').session(session).lean();
    const base = last.length;
    const members = sortByDrugOrder(await Drug.find({ groupId: id }).select('_id sortOrder createdAt').session(session).lean());
    if (members.length) {
      await Drug.bulkWrite(
        members.map((drug, index) => ({
          updateOne: { filter: { _id: drug._id }, update: { $set: { groupId: null, sortOrder: base + index } } },
        })),
        { session }
      );
    }
    return true;
  });
}
