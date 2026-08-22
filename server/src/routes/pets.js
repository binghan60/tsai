import { Router } from 'express';
import Pet from '../models/Pet.js';
import Owner from '../models/Owner.js';
import MedicalRecord from '../models/MedicalRecord.js';
import { withTransaction } from '../lib/transaction.js';

const PET_FIELDS = [
  'name',
  'species',
  'breed',
  'sex',
  'neutered',
  'birthDate',
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
    const pets = await Pet.find({ ownerId: req.params.ownerId }).sort({ createdAt: -1 });
    res.json(pets);
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
    const pets = await Pet.find(filter).sort({ updatedAt: -1 }).populate('ownerId', 'name phone');
    res.json(pets);
  } catch (err) {
    next(err);
  }
});

petsRouter.get('/:id', async (req, res, next) => {
  try {
    const pet = await Pet.findById(req.params.id).populate('ownerId', 'name phone email');
    if (!pet) return res.status(404).json({ message: '找不到寵物' });
    const medicalRecords = await MedicalRecord.find({ petId: pet._id })
      .sort({ visitDate: -1, reportVersion: -1, updatedAt: -1 })
      .select(MEDICAL_RECORD_SUMMARY_FIELDS)
      .lean();
    res.json({ ...pet.toObject(), medicalRecords });
  } catch (err) {
    next(err);
  }
});

petsRouter.put('/:id', async (req, res, next) => {
  try {
    const pet = await Pet.findByIdAndUpdate(req.params.id, pickPetFields(req.body), { new: true, runValidators: true });
    if (!pet) return res.status(404).json({ message: '找不到寵物' });
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
        const error = new Error('此寵物仍有健檢紀錄，無法刪除');
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
