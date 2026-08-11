import { Router } from 'express';
import Pet from '../models/Pet.js';
import MedicalRecord from '../models/MedicalRecord.js';

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
    const { name } = req.body;
    const pet = await Pet.create({ name, ownerId: req.params.ownerId });
    res.status(201).json(pet);
  } catch (err) {
    next(err);
  }
});

// 掛載於 /api/pets
export const petsRouter = Router();

petsRouter.get('/:id', async (req, res, next) => {
  try {
    const pet = await Pet.findById(req.params.id);
    if (!pet) return res.status(404).json({ message: '找不到貓咪' });
    const medicalRecords = await MedicalRecord.find({ petId: pet._id }).sort({ visitDate: -1 });
    res.json({ ...pet.toObject(), medicalRecords });
  } catch (err) {
    next(err);
  }
});

petsRouter.put('/:id', async (req, res, next) => {
  try {
    const { name } = req.body;
    const pet = await Pet.findByIdAndUpdate(req.params.id, { name }, { new: true, runValidators: true });
    if (!pet) return res.status(404).json({ message: '找不到貓咪' });
    res.json(pet);
  } catch (err) {
    next(err);
  }
});

petsRouter.delete('/:id', async (req, res, next) => {
  try {
    const recordCount = await MedicalRecord.countDocuments({ petId: req.params.id });
    if (recordCount > 0) {
      return res.status(409).json({ message: '此貓咪仍有報告紀錄，無法刪除' });
    }
    const pet = await Pet.findByIdAndDelete(req.params.id);
    if (!pet) return res.status(404).json({ message: '找不到貓咪' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
