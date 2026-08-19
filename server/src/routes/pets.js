import { Router } from 'express';
import Pet from '../models/Pet.js';
import Owner from '../models/Owner.js';
import MedicalRecord from '../models/MedicalRecord.js';

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
    const pet = await Pet.create({ ...pickPetFields(req.body), ownerId: req.params.ownerId });
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
    const medicalRecords = await MedicalRecord.find({ petId: pet._id }).sort({ visitDate: -1, reportVersion: -1, updatedAt: -1 });
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
    const recordCount = await MedicalRecord.countDocuments({ petId: req.params.id });
    if (recordCount > 0) {
      return res.status(409).json({ message: '此寵物仍有健檢紀錄，無法刪除' });
    }
    const pet = await Pet.findByIdAndDelete(req.params.id);
    if (!pet) return res.status(404).json({ message: '找不到寵物' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
