import { Router } from 'express';
import mongoose from 'mongoose';
import IntakeSubmission from '../models/IntakeSubmission.js';
import Appointment from '../models/Appointment.js';
import Owner from '../models/Owner.js';
import Pet from '../models/Pet.js';
import { withTransaction } from '../lib/transaction.js';
import { combineClinicDateTime } from '../lib/clinicTime.js';
import { createRateLimiter } from '../lib/rateLimit.js';
import { emitAppointmentUpdate, emitIntakeUpdate } from '../lib/realtime.js';
import { INTAKE_PET_FIELDS, mergeIntakeEdit } from '../lib/intakeEdit.js';
import { APPOINTMENT_TIME_ERROR, isValidAppointmentTime, normalizeEstimatedDuration, normalizeSurgeryFields, validateAppointmentDuration } from '../lib/appointmentTime.js';
import { MOBILE_PHONE_ERROR, normalizeMobilePhone } from '../../../shared/phone.js';
import { checkCatBreed } from '../../../shared/catBreeds.js';
import { intakePetIssues } from '../../../shared/intakeRequired.js';

const pickPetFields = body => Object.fromEntries(INTAKE_PET_FIELDS.filter(field => body[field] !== undefined).map(field => [field, body[field]]));
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
    if (!String(owner.address || '').trim()) return res.status(422).json({ message: '請填寫飼主地址' });
    if (!String(owner.email || '').trim()) return res.status(422).json({ message: '請填寫 Email' });
    // 公開頁收的是手機（櫃台要能聯絡到人）；市話另有欄位。
    const phone = normalizeMobilePhone(owner.phone);
    if (String(owner.phone || '').trim() && !phone) return res.status(422).json({ message: MOBILE_PHONE_ERROR });
    if (phone) owner.phone = phone;
    if (!String(pet.breed || '').trim()) return res.status(422).json({ message: '請選擇品種' });
    const breed = checkCatBreed(pet.breed);
    if (breed.error) return res.status(422).json({ message: breed.error });
    pet.breed = breed.breed;
    if (!['male', 'female'].includes(pet.sex)) return res.status(422).json({ message: '請選擇性別' });
    if (!['yes', 'no'].includes(pet.neutered)) return res.status(422).json({ message: '請選擇結紮狀態' });
    if (!pet.birthDate || Number.isNaN(new Date(pet.birthDate).getTime())) return res.status(422).json({ message: '請填寫有效年齡' });
    // 除了市話每一欄都必填；規則跟公開初診頁共用，這裡擋改版前就開著的分頁送來的不完整資料。
    const missing = Object.values(intakePetIssues(pet))[0];
    if (missing) return res.status(422).json({ message: missing });
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
    emitIntakeUpdate();
    res.status(201).json({ id: submission._id, status: submission.status });
  } catch (err) { next(err); }
});

intakeSubmissionsRouter.get('/', async (req, res, next) => {
  try {
    const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
    const items = await IntakeSubmission.find({ status })
      .populate('linkedAppointmentId', 'date time reason internalNote')
      .sort({ createdAt: 1, _id: 1 })
      .limit(100);
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

// 審核前修改飼主填的內容（填錯字、電話少一碼……）。只有待審核的能改；body.version 必須是目前的 __v。
// 飼主送出時掛號上寫過姓名、電話、貓咪名字的快照（時間軸靠它顯示），同一個 transaction 裡一起更新。
intakeSubmissionsRouter.put('/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(422).json({ message: '初診表編號格式不正確' });
    let submission;
    let appointment;
    await withTransaction(async (session) => {
      submission = await IntakeSubmission.findById(req.params.id).session(session);
      if (!submission) throw Object.assign(new Error('找不到初診表'), { status: 404 });
      if (submission.status !== 'pending') throw Object.assign(new Error('這份初診表已完成審核，不能再修改'), { status: 409 });
      if (req.body?.version !== undefined && req.body.version !== submission.__v) {
        throw Object.assign(new Error('這份初診表剛被修改過，請重新載入後再改'), { status: 409 });
      }
      const { owner, pet } = mergeIntakeEdit({ owner: submission.owner.toObject(), pet: submission.pet.toObject() }, req.body);
      submission.set({ owner, pet });
      await submission.save({ session });
      if (submission.linkedAppointmentId) {
        appointment = await Appointment.findById(submission.linkedAppointmentId).session(session);
        if (appointment && !appointment.petId) {
          appointment.ownerName = owner.name;
          appointment.ownerPhone = owner.phone;
          appointment.petName = pet.name;
          await appointment.save({ session });
        } else {
          appointment = null;
        }
      }
    });
    if (appointment) emitAppointmentUpdate(appointment);
    emitIntakeUpdate();
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
      // 改版前送出的初診表，品種可能是中文名稱或自由文字：清單上的整理成英文，其餘照原文帶過去。
      const petFields = pickPetFields(submission.pet.toObject());
      petFields.breed = checkCatBreed(petFields.breed, petFields.breed).breed;
      [pet] = await Pet.create([{
        ...petFields,
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
          // 跟新增掛號同一套時段規則（lib/appointmentTime.js），而且日期、時段都必填——
          // 審核通過就是一筆正式掛號，要落得在時間軸的某一格上。
          const date = String(req.body?.date || '').trim();
          const time = String(req.body?.time || '').trim();
          if (!date) throw Object.assign(new Error('請選擇掛號日期'), { status: 422 });
          if (!time) throw Object.assign(new Error('請選擇預約時段'), { status: 422 });
          const parsedDate = new Date(`${date}T00:00:00Z`);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
            throw Object.assign(new Error('掛號日期格式不正確'), { status: 422 });
          }
          if (!isValidAppointmentTime(time)) throw Object.assign(new Error(APPOINTMENT_TIME_ERROR), { status: 422 });
          // 預估診療時間與手術標記也跟掛號視窗一樣；沒帶就沿用掛號上原本的值。
          const estimatedDurationMinutes = normalizeEstimatedDuration(req.body?.estimatedDurationMinutes ?? appointment.estimatedDurationMinutes);
          validateAppointmentDuration(time, estimatedDurationMinutes);
          const surgery = normalizeSurgeryFields(req.body?.isSurgery !== undefined ? req.body : appointment);
          appointment.estimatedDurationMinutes = estimatedDurationMinutes;
          appointment.isSurgery = surgery.isSurgery;
          appointment.surgeryName = surgery.surgeryName;
          appointment.ownerId = owner._id;
          appointment.petId = pet._id;
          appointment.ownerName = owner.name;
          appointment.ownerPhone = owner.phone;
          appointment.petName = pet.name;
          appointment.species = pet.species;
          appointment.intakeSubmissionId = submission._id;
          appointment.date = date;
          appointment.time = time;
          appointment.scheduledAt = combineClinicDateTime(date, time);
          if (req.body?.reason !== undefined) appointment.reason = String(req.body.reason || '').trim();
          if (req.body?.internalNote !== undefined) appointment.internalNote = String(req.body.internalNote || '').trim();
          await appointment.save({ session });
        }
      }
      await submission.save({ session });
    });
    if (appointment) emitAppointmentUpdate(appointment);
    emitIntakeUpdate();
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
    emitIntakeUpdate();
    res.json(submission);
  } catch (err) { next(err); }
});
