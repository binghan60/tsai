import { Router } from 'express';
import mongoose from 'mongoose';
import IntakeSubmission from '../models/IntakeSubmission.js';
import Owner from '../models/Owner.js';
import Pet from '../models/Pet.js';
import { withTransaction } from '../lib/transaction.js';
import { createRateLimiter } from '../lib/rateLimit.js';

const PET_FIELDS = ['name', 'species', 'breed', 'color', 'sex', 'neutered', 'birthDate', 'birthDateEstimated', 'householdCatCount', 'diet', 'foods', 'feedingType', 'mealsPerDay', 'vaccineStatus', 'vaccineDate', 'medicalHistory', 'medicalHistoryOther', 'allergyStatus', 'allergyType', 'checkupStatus', 'checkupDate'];
const pickPetFields = body => Object.fromEntries(PET_FIELDS.filter(field => body[field] !== undefined).map(field => [field, body[field]]));
const publicSubmissionLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });

function validationError(owner, pet) {
  if (!String(owner?.name || '').trim()) return '請填寫飼主姓名';
  if (!String(owner?.phone || '').trim()) return '請填寫聯絡電話';
  if (String(owner?.email || '').trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(owner.email).trim())) return 'Email 格式不正確';
  if (!String(pet?.name || '').trim()) return '請填寫寵物名字';
  return '';
}

export const publicIntakeRouter = Router();
export const intakeSubmissionsRouter = Router();

publicIntakeRouter.post('/', publicSubmissionLimiter, async (req, res, next) => {
  try {
    const owner = req.body?.owner ?? {};
    const pet = req.body?.pet ?? {};
    const message = validationError(owner, pet);
    if (message) return res.status(422).json({ message });
    const submission = await IntakeSubmission.create({
      owner: { name: owner.name, phone: owner.phone, landline: owner.landline, email: owner.email, address: owner.address },
      pet: pickPetFields(pet),
    });
    res.status(201).json({ id: submission._id, status: submission.status });
  } catch (err) { next(err); }
});

intakeSubmissionsRouter.get('/', async (req, res, next) => {
  try {
    const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
    const items = await IntakeSubmission.find({ status }).sort({ createdAt: 1, _id: 1 }).limit(100);
    res.json({ items });
  } catch (err) { next(err); }
});

intakeSubmissionsRouter.post('/:id/approve', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(422).json({ message: '初診表編號格式不正確' });
    let submission;
    let pet;
    await withTransaction(async (session) => {
      submission = await IntakeSubmission.findById(req.params.id).session(session);
      if (!submission) throw Object.assign(new Error('找不到初診表'), { status: 404 });
      if (submission.status !== 'pending') throw Object.assign(new Error('這份初診表已完成審核'), { status: 409 });
      const [owner] = await Owner.create([{
        name: submission.owner.name,
        phone: submission.owner.phone,
        landline: submission.owner.landline,
        email: submission.owner.email,
        address: submission.owner.address,
        relationVersion: 1,
      }], { session });
      [pet] = await Pet.create([{
        ...pickPetFields(submission.pet.toObject()),
        ownerId: owner._id,
      }], { session });
      submission.status = 'approved';
      submission.reviewNote = String(req.body?.reviewNote || '').trim();
      submission.reviewedAt = new Date();
      submission.approvedOwnerId = owner._id;
      submission.approvedPetId = pet._id;
      await submission.save({ session });
    });
    res.json({ submission, pet });
  } catch (err) { next(err); }
});

intakeSubmissionsRouter.post('/:id/reject', async (req, res, next) => {
  try {
    const submission = await IntakeSubmission.findOneAndUpdate(
      { _id: req.params.id, status: 'pending' },
      { $set: { status: 'rejected', reviewNote: String(req.body?.reviewNote || '').trim(), reviewedAt: new Date() }, $inc: { __v: 1 } },
      { new: true, runValidators: true }
    );
    if (!submission) return res.status(409).json({ message: '找不到待審核的初診表，可能已被其他人處理' });
    res.json(submission);
  } catch (err) { next(err); }
});
