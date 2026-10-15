import { Router } from 'express';
import mongoose from 'mongoose';
import Pet from '../models/Pet.js';
import Owner from '../models/Owner.js';
import MedicalRecord from '../models/MedicalRecord.js';
import ClinicalNote from '../models/ClinicalNote.js';
import PinnedPet from '../models/PinnedPet.js';
import Appointment from '../models/Appointment.js';
import { attendanceCountPipeline, attendanceCounts, attendanceListFilter, attendanceRow } from '../lib/attendance.js';
import { petDepositState } from '../lib/deposit.js';
import Todo from '../models/Todo.js';
import { publishPinnedPets } from '../lib/pinnedPets.js';
import { publishTodos } from '../lib/todos.js';
import { emitAppointmentUpdate, emitLabResultsUpdate } from '../lib/realtime.js';
import { clinicalNoteViews } from '../lib/clinicalNoteView.js';
import { withTransaction } from '../lib/transaction.js';
import { paginatedPayload, paginationMeta, paginationOptions } from '../lib/pagination.js';
import { checkCatBreed } from '../../../shared/catBreeds.js';
import { pickPetFields } from '../lib/petFields.js';
import { escapeRegExp } from '../lib/regex.js';
import MedicationOrder from '../models/MedicationOrder.js';
import { releaseLabResults } from '../lib/labResultApply.js';
import { latestPetWeight } from '../lib/latestWeight.js';
import { ensureClinicOwner, isClinicOwner } from '../lib/clinicOwner.js';
import { moveScheduledAppointments, syncStraySnapshots } from '../lib/strayPet.js';
import { checkMobilePhone } from '../../../shared/phone.js';

const MEDICAL_RECORD_SUMMARY_FIELDS =
  'petId vet visitDate examType status deliveryStatus deliveryError reportVersion revisionOf revisionRootId supersededBy shareToken shareEnabled sharedAt shareExpiresAt sentAt sentTo finalizedAt updatedAt createdAt';

// 掛載於 /api/owners/:ownerId/pets
export const ownerPetsRouter = Router({ mergeParams: true });

ownerPetsRouter.get('/', async (req, res, next) => {
  try {
    const pagination = paginationOptions(req.query);
    const filter = { ownerId: req.params.ownerId };
    const [pets, total] = await Promise.all([
      Pet.find(filter).sort({ createdAt: -1, _id: -1 }).skip(pagination.skip).limit(pagination.limit),
      Pet.countDocuments(filter),
    ]);
    res.json(paginatedPayload(pets, total, pagination));
  } catch (err) {
    next(err);
  }
});

// ownerId 是 clinic 時建在院內飼主名下（沒人負責的流浪貓），一律標成流浪貓。
ownerPetsRouter.post('/', async (req, res, next) => {
  try {
    const breed = checkCatBreed(req.body?.breed);
    if (breed.error) return res.status(422).json({ message: breed.error });
    const fields = pickPetFields(req.body);
    if (fields.breed !== undefined) fields.breed = breed.breed;
    const clinic = req.params.ownerId === 'clinic';
    const ownerId = clinic ? (await ensureClinicOwner())._id : req.params.ownerId;
    if (clinic) fields.isStray = true;
    let pet;
    await withTransaction(async (session) => {
      const parent = await Owner.findOneAndUpdate(
        { _id: ownerId },
        { $inc: { relationVersion: 1 } },
        { new: true, session }
      ).select('+relationVersion');
      if (!parent) {
        const error = new Error('找不到飼主，無法建立貓咪');
        error.status = 404;
        throw error;
      }
      [pet] = await Pet.create([{ ...fields, ownerId: parent._id }], { session });
    });
    res.status(201).json(pet);
  } catch (err) {
    next(err);
  }
});

// 掛載於 /api/pets
export const petsRouter = Router();

// GET /api/pets?q=關鍵字
petsRouter.get('/', async (req, res, next) => {
  try {
    const query = String(req.query.q ?? '').trim();
    let filter = {};
    if (query) {
      const pattern = new RegExp(escapeRegExp(query), 'i');
      const owners = await Owner.find({
        $or: [{ name: pattern }, { phone: pattern }, { landline: pattern }],
      }).select('_id');
      filter = {
        $or: [
          { name: pattern },
          { ownerId: { $in: owners.map((owner) => owner._id) } },
        ],
      };
    }
    const pagination = paginationOptions(req.query, { defaultLimit: 10 });
    const [pets, total] = await Promise.all([
      Pet.find(filter)
        .sort({ updatedAt: -1, _id: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .populate('ownerId', 'name phone'),
      Pet.countDocuments(filter),
    ]);
    // 清單上的「最近紀錄」：這一頁每隻貓最新一則病歷日誌的日期（看診、藥單、手動記事都算）。
    // 只查這一頁的貓，走 {petId, entryDate} 索引。
    const latest = pets.length
      ? await ClinicalNote.aggregate([
        { $match: { petId: { $in: pets.map((pet) => pet._id) } } },
        { $sort: { petId: 1, entryDate: -1 } },
        { $group: { _id: '$petId', lastEntryAt: { $first: '$entryDate' } } },
      ])
      : [];
    const lastEntryAt = new Map(latest.map((row) => [String(row._id), row.lastEntryAt]));
    const items = pets.map((pet) => ({ ...pet.toJSON(), lastEntryAt: lastEntryAt.get(String(pet._id)) ?? null }));
    res.json(paginatedPayload(items, total, pagination));
  } catch (err) {
    next(err);
  }
});

petsRouter.get('/:id', async (req, res, next) => {
  try {
    // 診療台開著某次看診時帶 excludeAppointmentId，最近體重不算那一次（lib/latestWeight.js）。
    const excludeAppointmentId = req.query.excludeAppointmentId;
    if (excludeAppointmentId !== undefined && !mongoose.isValidObjectId(excludeAppointmentId)) {
      return res.status(422).json({ message: '掛號編號格式不正確' });
    }
    const pet = await Pet.findById(req.params.id).populate('ownerId', 'name phone landline email address notes kind __v');
    if (!pet) return res.status(404).json({ message: '找不到貓咪' });
    const pagination = paginationOptions(req.query, {
      defaultLimit: 10,
      maxLimit: 50,
      pageParam: 'recordPage',
      limitParam: 'recordLimit',
    });
    const filter = { petId: pet._id };
    const notePagination = paginationOptions(req.query, {
      defaultLimit: 10,
      maxLimit: 50,
      pageParam: 'notePage',
      limitParam: 'noteLimit',
    });
    const noteFilter = { petId: pet._id };
    const [medicalRecords, total, clinicalNotes, noteTotal, latestWeight] = await Promise.all([
      MedicalRecord.find(filter)
        .sort({ visitDate: -1, reportVersion: -1, updatedAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .select(MEDICAL_RECORD_SUMMARY_FIELDS)
        .lean(),
      MedicalRecord.countDocuments(filter),
      ClinicalNote.find(noteFilter)
        .sort({ entryDate: -1, _id: -1 })
        .skip(notePagination.skip)
        .limit(notePagination.limit)
        .lean(),
      ClinicalNote.countDocuments(noteFilter),
      latestPetWeight(pet, { excludeAppointmentId }),
    ]);
    res.json({
      ...pet.toObject(),
      // 最近體重：看診與已結案報告裡日期最新的量測，沒有才用貓咪資料手填的 weightKg（lib/latestWeight.js）。
      latestWeight,
      medicalRecords,
      recordPagination: paginationMeta(total, pagination),
      clinicalNotes: await clinicalNoteViews(clinicalNotes),
      notePagination: paginationMeta(noteTotal, notePagination),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/pets/:id/attendance?scope=pet|owner — 出席紀錄清單，新到舊、分頁：遲到、未到，
// 加上已取消的掛號與約診時決定過保證金的掛號（lib/attendance.js 的 attendanceListFilter）。
// counts 只算遲到與未到（這隻貓、飼主名下全部各一組），頁首徽章與清單上方那排次數用它；頁籤上的數字是清單總筆數。
petsRouter.get('/:id/attendance', async (req, res, next) => {
  try {
    const pet = await Pet.findById(req.params.id).select('ownerId').lean();
    if (!pet) return res.status(404).json({ message: '找不到貓咪' });
    const petScope = { petId: pet._id };
    const ownerScope = pet.ownerId ? { ownerId: pet.ownerId } : petScope;
    const scope = req.query.scope === 'owner' ? 'owner' : 'pet';
    const filter = attendanceListFilter(scope === 'owner' ? ownerScope : petScope);
    const pagination = paginationOptions(req.query, { defaultLimit: 10, maxLimit: 50 });
    const [appointments, total, petGroups, ownerGroups, deposit] = await Promise.all([
      Appointment.find(filter)
        .sort({ date: -1, time: -1, _id: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .select('date time status checkedInAt latenessMinutes petId petName reason depositStatus depositWaiveReason depositDecidedAt cancelledAt cancelReason')
        .lean(),
      Appointment.countDocuments(filter),
      Appointment.aggregate(attendanceCountPipeline(petScope)),
      Appointment.aggregate(attendanceCountPipeline(ownerScope)),
      petDepositState(pet._id),
    ]);
    res.json({
      ...paginatedPayload(appointments.map(attendanceRow), total, pagination),
      scope,
      counts: { pet: attendanceCounts(petGroups), owner: attendanceCounts(ownerGroups) },
      // 這隻貓現在約診要不要先收保證金（上次收了之後重新算的次數，見 lib/deposit.js）。
      deposit,
    });
  } catch (err) {
    next(err);
  }
});

petsRouter.put('/:id', async (req, res, next) => {
  try {
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return res.status(428).json({ message: '缺少貓咪資料版本，請重新整理後再試' });
    }
    // 品種只收清單上的，存成 IDEXX 的英文名稱；沒動到的舊值（清單以外的）照收，見 shared/catBreeds.js。
    const fields = pickPetFields(req.body);
    if (fields.breed !== undefined) {
      let breed = checkCatBreed(fields.breed);
      if (breed.error) {
        const stored = await Pet.findById(req.params.id).select('breed');
        if (!stored) return res.status(404).json({ message: '找不到貓咪' });
        breed = checkCatBreed(fields.breed, stored.breed);
        if (breed.error) return res.status(422).json({ message: breed.error });
      }
      fields.breed = breed.breed;
    }
    // 院內飼主名下的貓一定是流浪貓：要拿掉標記得先換飼主（被認養）。
    if (fields.isStray !== undefined) {
      fields.isStray = fields.isStray === true;
      if (!fields.isStray) {
        const stored = await Pet.findById(req.params.id).select('ownerId').populate('ownerId', 'kind').lean();
        if (!stored) return res.status(404).json({ message: '找不到貓咪' });
        if (isClinicOwner(stored.ownerId)) return res.status(422).json({ message: '院內的貓要先換飼主，才能拿掉流浪貓標記' });
      }
    }
    let pet = null;
    let synced = [];
    await withTransaction(async (session) => {
      synced = [];
      pet = await Pet.findOneAndUpdate(
        { _id: req.params.id, __v: expectedVersion },
        { $set: fields, $inc: { __v: 1 } },
        { new: true, runValidators: true, session }
      );
      // 流浪貓標記改了：今天以後的掛號卡片跟著換徽章。
      if (pet && fields.isStray !== undefined) synced = await syncStraySnapshots(pet._id, pet.isStray, { session });
    });
    if (!pet) {
      const current = await Pet.findById(req.params.id).select('__v');
      if (!current) return res.status(404).json({ message: '找不到貓咪' });
      return res.status(409).json({
        message: '貓咪資料已被其他分頁更新，已重新載入最新內容，請確認後再修改',
        currentVersion: current.__v,
      });
    }
    for (const appointment of synced) emitAppointmentUpdate(appointment);
    res.json(pet);
  } catch (err) {
    next(err);
  }
});

// POST /api/pets/:id/transfer-owner — 換飼主（流浪貓被認養、愛媽轉給別人）。
// body：{ expectedVersion, ownerId } 換到既有飼主，或 { expectedVersion, owner: { name, phone } } 建一位新飼主；
// clearStray: true 一併拿掉流浪貓標記。不能換到院內（要放回院內的情況少，先不做）。
// 還沒報到的掛號跟著換到新飼主；已經發生的看診、報告、藥單保留當時的飼主名字（快照）。
petsRouter.post('/:id/transfer-owner', async (req, res, next) => {
  try {
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return res.status(428).json({ message: '缺少貓咪資料版本，請重新整理後再試' });
    }
    const targetId = req.body?.ownerId;
    const newOwner = req.body?.owner;
    let ownerInput = null;
    if (targetId) {
      if (!mongoose.isValidObjectId(targetId)) return res.status(422).json({ message: '飼主編號格式不正確' });
    } else {
      const name = String(newOwner?.name ?? '').trim();
      if (!name) return res.status(422).json({ message: '請填寫新飼主姓名' });
      if (!String(newOwner?.phone ?? '').trim()) return res.status(422).json({ message: '請填寫新飼主手機' });
      const checked = checkMobilePhone(newOwner.phone);
      if (checked.error) return res.status(422).json({ message: checked.error });
      ownerInput = { name, phone: checked.phone };
    }
    const clearStray = req.body?.clearStray === true;

    let pet = null;
    let moved = [];
    let synced = [];
    await withTransaction(async (session) => {
      moved = [];
      synced = [];
      const current = await Pet.findById(req.params.id).session(session);
      if (!current) throw Object.assign(new Error('找不到貓咪'), { status: 404 });
      if (current.__v !== expectedVersion) {
        throw Object.assign(new Error('貓咪資料已被其他分頁更新，請重新整理後再試'), { status: 409 });
      }
      let owner;
      if (ownerInput) {
        [owner] = await Owner.create([{ ...ownerInput, relationVersion: 1 }], { session });
      } else {
        // 新舊飼主都遞增 relationVersion：跟「刪除飼主」在 transaction 裡互相衝突，不會換到一位剛被刪掉的飼主。
        owner = await Owner.findOneAndUpdate({ _id: targetId }, { $inc: { relationVersion: 1 } }, { new: true, session });
        if (!owner) throw Object.assign(new Error('找不到指定的飼主'), { status: 422 });
        if (isClinicOwner(owner)) throw Object.assign(new Error('不能換到院內'), { status: 422 });
      }
      if (String(owner._id) === String(current.ownerId)) throw Object.assign(new Error('新飼主跟目前的飼主是同一位'), { status: 422 });
      await Owner.updateOne({ _id: current.ownerId }, { $inc: { relationVersion: 1 } }, { session });
      const isStray = clearStray ? false : current.isStray;
      pet = await Pet.findOneAndUpdate(
        { _id: current._id, __v: expectedVersion },
        { $set: { ownerId: owner._id, isStray }, $inc: { __v: 1 } },
        { new: true, session }
      );
      if (!pet) throw Object.assign(new Error('貓咪資料已被其他分頁更新，請重新整理後再試'), { status: 409 });
      moved = await moveScheduledAppointments(pet._id, owner, isStray, { session });
      if (isStray !== current.isStray) synced = await syncStraySnapshots(pet._id, isStray, { session });
    });
    const emitted = new Set();
    for (const appointment of [...moved, ...synced]) {
      if (emitted.has(String(appointment._id))) continue;
      emitted.add(String(appointment._id));
      emitAppointmentUpdate(appointment);
    }
    res.json(pet);
  } catch (err) {
    next(err);
  }
});

petsRouter.delete('/:id', async (req, res, next) => {
  try {
    let removedPin = false;
    let unlinkedTodos = false;
    let releasedLabResults = false;
    await withTransaction(async (session) => {
      const pet = await Pet.findById(req.params.id).session(session);
      if (!pet) {
        const error = new Error('找不到貓咪');
        error.status = 404;
        throw error;
      }
      if (await MedicalRecord.exists({ petId: pet._id }).session(session)) {
        const error = new Error('此貓咪仍有健檢報告，無法刪除');
        error.status = 409;
        throw error;
      }
      if (await ClinicalNote.exists({ petId: pet._id }).session(session)) {
        const error = new Error('此貓咪仍有病歷日誌，無法刪除');
        error.status = 409;
        throw error;
      }
      // 還在流程裡的掛號與藥單指著這隻貓：刪掉之後時間軸與藥單清單上會留下一筆打不開、報到後也沒有貓可以連的資料。
      if (await Appointment.exists({ petId: pet._id, status: { $nin: ['cancelled', 'no_show'] } }).session(session)) {
        const error = new Error('此貓咪仍有掛號紀錄（待報到、看診中或已完成），無法刪除');
        error.status = 409;
        throw error;
      }
      if (await MedicationOrder.exists({ petId: pet._id, status: { $ne: 'cancelled' } }).session(session)) {
        const error = new Error('此貓咪仍有藥單，無法刪除');
        error.status = 409;
        throw error;
      }
      const deleted = await Pet.deleteOne({ _id: pet._id }, { session });
      if (deleted.deletedCount !== 1) {
        const error = new Error('貓咪資料正在被其他操作更新，請重新整理後再試');
        error.status = 409;
        throw error;
      }
      // 已取消／未到的掛號、已取消的藥單沒有成立過，跟著貓咪一起刪掉；認到這隻貓、卻沒有看診的檢驗結果放回待確認清單。
      await Appointment.deleteMany({ petId: pet._id }, { session });
      await MedicationOrder.deleteMany({ petId: pet._id }, { session });
      releasedLabResults = (await releaseLabResults({ petId: pet._id }, { session })) > 0;
      // 暫存紀錄不是病歷，不擋刪除，跟著貓咪一起消失。
      removedPin = (await PinnedPet.deleteOne({ petId: pet._id }, { session })).deletedCount > 0;
      // 待辦同理不擋刪除：只把標記裡的 petId 清成 null，petName／ownerName 快照留著，那筆待辦仍讀得懂。
      unlinkedTodos = (await Todo.updateMany(
        { 'mentions.petId': pet._id },
        { $set: { 'mentions.$[m].petId': null } },
        { session, arrayFilters: [{ 'm.petId': pet._id }] }
      )).modifiedCount > 0;
    });
    if (removedPin) await publishPinnedPets();
    if (unlinkedTodos) await publishTodos();
    if (releasedLabResults) emitLabResultsUpdate();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
