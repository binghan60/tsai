import { Router } from 'express';
import mongoose from 'mongoose';
import IntakeSubmission from '../models/IntakeSubmission.js';
import Appointment from '../models/Appointment.js';
import Owner from '../models/Owner.js';
import Pet from '../models/Pet.js';
import { withTransaction } from '../lib/transaction.js';
import { combineClinicDateTime } from '../lib/clinicTime.js';
import { createRateLimiter } from '../lib/rateLimit.js';
import { emitAppointmentUpdate } from '../lib/realtime.js';

const PET_FIELDS = ['name', 'species', 'breed', 'color', 'sex', 'neutered', 'birthDate', 'birthDateEstimated', 'householdCatCount', 'diet', 'foods', 'foodsOther', 'feedingType', 'mealsPerDay', 'vaccineStatus', 'vaccineDate', 'medicalHistory', 'medicalHistoryOther', 'allergyStatus', 'allergyType', 'checkupStatus', 'checkupDate'];
const pickPetFields = body => Object.fromEntries(PET_FIELDS.filter(field => body[field] !== undefined).map(field => [field, body[field]]));
const publicSubmissionLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });
const publicVerificationLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

function intakeVerificationCode(value) {
  const code = String(value ?? '').replace(/\D/g, '');
  return /^\d{4}$/.test(code) ? code : '';
}

function invalidVerificationError() {
  return Object.assign(new Error('驗證碼無效、已過期，或本次初診資料已送出'), { status: 409 });
}

function availableInitialAppointment(code) {
  return Appointment.findOne({
    intakeVerificationCode: code,
    intakeVerificationExpiresAt: { $gt: new Date() },
    intakeVerificationUsedAt: null,
    intakeSubmissionId: null,
    visitType: 'new',
    petId: null,
    status: { $in: ['scheduled', 'arrived'] },
  });
}

function validationError(owner, pet) {
  if (!String(owner?.name || '').trim()) return '請填寫飼主姓名';
  if (!String(owner?.phone || '').trim()) return '請填寫聯絡電話';
  if (String(owner?.email || '').trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(owner.email).trim())) return 'Email 格式不正確';
  if (!String(pet?.name || '').trim()) return '請填寫寵物名字';
  return '';
}

export const publicIntakeRouter = Router();
export const intakeSubmissionsRouter = Router();

publicIntakeRouter.post('/verify', publicVerificationLimiter, async (req, res, next) => {
  try {
    const code = intakeVerificationCode(req.body?.verificationCode);
    if (!code || !await availableInitialAppointment(code)) return res.status(409).json({ message: '驗證碼無效、已過期，或本次初診資料已送出' });
    res.json({ valid: true });
  } catch (err) { next(err); }
});

publicIntakeRouter.post('/', publicSubmissionLimiter, async (req, res, next) => {
  try {
    const owner = req.body?.owner ?? {};
    const pet = req.body?.pet ?? {};
    const message = validationError(owner, pet);
    if (message) return res.status(422).json({ message });
    const code = intakeVerificationCode(req.body?.verificationCode);
    if (!code) return res.status(422).json({ message: '請輸入櫃台提供的 4 位驗證碼' });
    let submission;
    let appointment;
    await withTransaction(async (session) => {
      appointment = await availableInitialAppointment(code).session(session);
      if (!appointment) throw invalidVerificationError();
      [submission] = await IntakeSubmission.create([{
        owner: { name: owner.name, phone: owner.phone, landline: owner.landline, email: owner.email, address: owner.address },
        pet: pickPetFields(pet),
        linkedAppointmentId: appointment._id,
      }], { session });
      appointment.intakeSubmissionId = submission._id;
      appointment.intakeVerificationUsedAt = new Date();
      appointment.ownerName = String(owner.name).trim();
      appointment.ownerPhone = String(owner.phone).trim();
      appointment.petName = String(pet.name).trim();
      appointment.species = String(pet.species || '貓').trim();
      await appointment.save({ session });
    });
    emitAppointmentUpdate(appointment);
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

intakeSubmissionsRouter.get('/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(422).json({ message: '初診表編號格式不正確' });
    const submission = await IntakeSubmission.findById(req.params.id);
    if (!submission) return res.status(404).json({ message: '找不到初診表' });
    res.json(submission);
  } catch (err) { next(err); }
});

intakeSubmissionsRouter.post('/:id/approve', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(422).json({ message: '初診表編號格式不正確' });
    let submission;
    let pet;
    let appointment;
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
      if (submission.linkedAppointmentId) {
        appointment = await Appointment.findById(submission.linkedAppointmentId).session(session);
        if (appointment && !appointment.petId) {
          const time = String(req.body?.time || '').trim();
          if (time && !/^\d{2}:\d{2}$/.test(time)) {
            throw Object.assign(new Error('掛號時間格式不正確'), { status: 422 });
          }
          appointment.ownerId = owner._id;
          appointment.petId = pet._id;
          appointment.ownerName = owner.name;
          appointment.ownerPhone = owner.phone;
          appointment.petName = pet.name;
          appointment.species = pet.species;
          appointment.intakeSubmissionId = submission._id;
          if (time) {
            appointment.time = time;
            appointment.scheduledAt = combineClinicDateTime(appointment.date, time);
          }
          await appointment.save({ session });
        }
      }
      await submission.save({ session });
    });
    if (appointment) emitAppointmentUpdate(appointment);
    res.json({ submission, pet, appointment });
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
