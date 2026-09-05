import { Router } from 'express';
import Pet from '../models/Pet.js';
import Owner from '../models/Owner.js';
import MedicalRecord from '../models/MedicalRecord.js';
import ClinicalNote from '../models/ClinicalNote.js';
import { withTransaction } from '../lib/transaction.js';
import { paginatedPayload, paginationMeta, paginationOptions } from '../lib/pagination.js';

const PET_FIELDS = [
  'name',
  'species',
  'breed',
  'sex',
  'neutered',
  'birthDate',
  'birthDateEstimated',
  'weightKg',
  'allergies',
  'chronicConditions',
  'currentMedications',
  'notes',
];
const MEDICAL_RECORD_SUMMARY_FIELDS =
  'petId reportNumber vet visitDate examType status deliveryStatus deliveryError reportVersion revisionOf revisionRootId supersededBy shareToken shareEnabled sharedAt shareExpiresAt sentAt sentTo finalizedAt updatedAt createdAt';

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
    let pet;
    await withTransaction(async (session) => {
      const parent = await Owner.findOneAndUpdate(
        { _id: req.params.ownerId },
        { $inc: { relationVersion: 1 } },
        { new: true, session }
      ).select('+relationVersion');
      if (!parent) {
        const error = new Error('找不到飼主，無法建立寵物');
        error.status = 404;
        throw error;
      }
      [pet] = await Pet.create([{ ...pickPetFields(req.body), ownerId: parent._id }], { session });
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
      const derivedRecordNumber = query.match(/^PET-([0-9A-F]{8})$/i);
      const owners = await Owner.find({
        $or: [{ name: pattern }, { phone: pattern }],
      }).select('_id');
      filter = {
        $or: [
          { name: pattern },
          { medicalRecordNumber: pattern },
          { ownerId: { $in: owners.map((owner) => owner._id) } },
          ...(derivedRecordNumber
            ? [{ $expr: { $regexMatch: { input: { $toString: '$_id' }, regex: `${derivedRecordNumber[1]}$`, options: 'i' } } }]
            : []),
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
    res.json(paginatedPayload(pets, total, pagination));
  } catch (err) {
    next(err);
  }
});

petsRouter.get('/:id', async (req, res, next) => {
  try {
    const pet = await Pet.findById(req.params.id).populate('ownerId', 'name phone email address notes __v');
    if (!pet) return res.status(404).json({ message: '找不到寵物' });
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
      clinicalNotes,
      notePagination: paginationMeta(noteTotal, notePagination),
    });
  } catch (err) {
    next(err);
  }
});

petsRouter.put('/:id', async (req, res, next) => {
  try {
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return res.status(428).json({ message: '缺少寵物資料版本，請重新整理後再試' });
    }
    const pet = await Pet.findOneAndUpdate(
      { _id: req.params.id, __v: expectedVersion },
      { $set: pickPetFields(req.body), $inc: { __v: 1 } },
      { new: true, runValidators: true }
    );
    if (!pet) {
      const current = await Pet.findById(req.params.id).select('__v');
      if (!current) return res.status(404).json({ message: '找不到寵物' });
      return res.status(409).json({
        message: '寵物資料已被其他分頁更新，已重新載入最新內容，請確認後再修改',
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
    await withTransaction(async (session) => {
      const pet = await Pet.findById(req.params.id).session(session);
      if (!pet) {
        const error = new Error('找不到寵物');
        error.status = 404;
        throw error;
      }
      if (await MedicalRecord.exists({ petId: pet._id }).session(session)) {
        const error = new Error('此寵物仍有就診紀錄，無法刪除');
        error.status = 409;
        throw error;
      }
      if (await ClinicalNote.exists({ petId: pet._id }).session(session)) {
        const error = new Error('此寵物仍有病歷日誌，無法刪除');
        error.status = 409;
        throw error;
      }
      const deleted = await Pet.deleteOne({ _id: pet._id }, { session });
      if (deleted.deletedCount !== 1) {
        const error = new Error('寵物資料正在被其他操作更新，請重新整理後再試');
        error.status = 409;
        throw error;
      }
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
