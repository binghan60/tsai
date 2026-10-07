import { Router } from 'express';
import Pet from '../models/Pet.js';
import Owner from '../models/Owner.js';
import MedicalRecord from '../models/MedicalRecord.js';
import ClinicalNote from '../models/ClinicalNote.js';
import PinnedPet from '../models/PinnedPet.js';
import Appointment from '../models/Appointment.js';
import { attendanceCountPipeline, attendanceCounts, attendanceFilter, attendanceRow } from '../lib/attendance.js';
import Todo from '../models/Todo.js';
import { publishPinnedPets } from '../lib/pinnedPets.js';
import { publishTodos } from '../lib/todos.js';
import { clinicalNoteViews } from '../lib/clinicalNoteView.js';
import { withTransaction } from '../lib/transaction.js';
import { paginatedPayload, paginationMeta, paginationOptions } from '../lib/pagination.js';
import { checkCatBreed } from '../../../shared/catBreeds.js';

const PET_FIELDS = [
  'name',
  'species',
  'breed',
  'color',
  'sex',
  'neutered',
  'birthDate',
  'birthDateEstimated',
  'weightKg',
  'householdCatCount',
  'diet',
  'foods',
  'foodsOther',
  'feedingType',
  'mealsPerDay',
  'vaccineStatus',
  'vaccineDate',
  'medicalHistory',
  'medicalHistoryOther',
  'allergyStatus',
  'allergyType',
  'checkupStatus',
  'checkupDate',
  'notes',
];
const MEDICAL_RECORD_SUMMARY_FIELDS =
  'petId vet visitDate examType status deliveryStatus deliveryError reportVersion revisionOf revisionRootId supersededBy shareToken shareEnabled sharedAt shareExpiresAt sentAt sentTo finalizedAt updatedAt createdAt';

function pickPetFields(body) {
  return Object.fromEntries(PET_FIELDS.filter((field) => body[field] !== undefined).map((field) => [field, body[field]]));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

ownerPetsRouter.post('/', async (req, res, next) => {
  try {
    const breed = checkCatBreed(req.body?.breed);
    if (breed.error) return res.status(422).json({ message: breed.error });
    const fields = pickPetFields(req.body);
    if (fields.breed !== undefined) fields.breed = breed.breed;
    let pet;
    await withTransaction(async (session) => {
      const parent = await Owner.findOneAndUpdate(
        { _id: req.params.ownerId },
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
        .populate('ownerId', 'name phone attendanceSummary'),
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
    const pet = await Pet.findById(req.params.id).populate('ownerId', 'name phone landline email address notes attendanceSummary __v');
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
    const [medicalRecords, total, clinicalNotes, noteTotal] = await Promise.all([
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
    ]);
    res.json({
      ...pet.toObject(),
      medicalRecords,
      recordPagination: paginationMeta(total, pagination),
      clinicalNotes: await clinicalNoteViews(clinicalNotes),
      notePagination: paginationMeta(noteTotal, notePagination),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/pets/:id/attendance?scope=pet|owner — 出席紀錄（遲到與未到），新到舊、分頁。
// counts 兩組都回（這隻貓、飼主名下全部），頁首徽章與頁籤數字用的就是這份，跟清單筆數同一個口徑。
petsRouter.get('/:id/attendance', async (req, res, next) => {
  try {
    const pet = await Pet.findById(req.params.id).select('ownerId').lean();
    if (!pet) return res.status(404).json({ message: '找不到貓咪' });
    const petScope = { petId: pet._id };
    const ownerScope = pet.ownerId ? { ownerId: pet.ownerId } : petScope;
    const scope = req.query.scope === 'owner' ? 'owner' : 'pet';
    const filter = attendanceFilter(scope === 'owner' ? ownerScope : petScope);
    const pagination = paginationOptions(req.query, { defaultLimit: 10, maxLimit: 50 });
    const [appointments, total, petGroups, ownerGroups] = await Promise.all([
      Appointment.find(filter)
        .sort({ date: -1, time: -1, _id: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .select('date time status checkedInAt latenessMinutes petId petName reason')
        .lean(),
      Appointment.countDocuments(filter),
      Appointment.aggregate(attendanceCountPipeline(petScope)),
      Appointment.aggregate(attendanceCountPipeline(ownerScope)),
    ]);
    res.json({
      ...paginatedPayload(appointments.map(attendanceRow), total, pagination),
      scope,
      counts: { pet: attendanceCounts(petGroups), owner: attendanceCounts(ownerGroups) },
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
    const pet = await Pet.findOneAndUpdate(
      { _id: req.params.id, __v: expectedVersion },
      { $set: fields, $inc: { __v: 1 } },
      { new: true, runValidators: true }
    );
    if (!pet) {
      const current = await Pet.findById(req.params.id).select('__v');
      if (!current) return res.status(404).json({ message: '找不到貓咪' });
      return res.status(409).json({
        message: '貓咪資料已被其他分頁更新，已重新載入最新內容，請確認後再修改',
        currentVersion: current.__v,
      });
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
      const deleted = await Pet.deleteOne({ _id: pet._id }, { session });
      if (deleted.deletedCount !== 1) {
        const error = new Error('貓咪資料正在被其他操作更新，請重新整理後再試');
        error.status = 409;
        throw error;
      }
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
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
