import { Router } from 'express';
import Owner from '../models/Owner.js';
import Pet from '../models/Pet.js';
import Appointment from '../models/Appointment.js';
import { attendanceCountPipeline, attendanceCounts } from '../lib/attendance.js';
import { withTransaction } from '../lib/transaction.js';
import { paginatedPayload, paginationMeta, paginationOptions } from '../lib/pagination.js';
import { escapeRegExp } from '../lib/regex.js';
import { checkMobilePhone } from '../../../shared/phone.js';
import { checkCatBreed } from '../../../shared/catBreeds.js';
import { pickPetFields } from '../lib/petFields.js';

const router = Router();

// previousPhone：修改既有飼主時傳原本的電話，沒改動的舊資料（常是市話）照收，見 shared/phone.js。
function validateOwnerInput({ name, phone, email }, previousPhone) {
  if (!String(name || '').trim()) return '請填寫飼主姓名';
  if (!String(phone || '').trim()) return '請填寫聯絡電話';
  const { error: phoneError } = checkMobilePhone(phone, previousPhone);
  if (phoneError) return phoneError;
  if (String(email || '').trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) return 'Email 格式不正確';
  return '';
}

// GET /api/owners?q=關鍵字
router.get('/', async (req, res, next) => {
  try {
    const { q } = req.query;
    const keyword = q ? new RegExp(escapeRegExp(String(q)), 'i') : null;
    const filter = keyword
      ? { $or: [{ name: keyword }, { phone: keyword }, { landline: keyword }] }
      : {};
    const pagination = paginationOptions(req.query, { defaultLimit: 10 });
    const [owners, total] = await Promise.all([
      Owner.find(filter).sort({ createdAt: -1, _id: -1 }).skip(pagination.skip).limit(pagination.limit),
      Owner.countDocuments(filter),
    ]);
    res.json(paginatedPayload(owners, total, pagination));
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, phone, landline, email, address, notes } = req.body;
    const validationError = validateOwnerInput({ name, phone, email });
    if (validationError) return res.status(422).json({ message: validationError });
    const owner = await Owner.create({ name, phone: checkMobilePhone(phone).phone, landline, email, address, notes });
    res.status(201).json(owner);
  } catch (err) {
    next(err);
  }
});

// 新飼主與其第一隻貓咪必須同時存在；任何一端驗證或寫入失敗都會完整回滾。
router.post('/with-pet', async (req, res, next) => {
  try {
    const ownerInput = req.body?.owner ?? {};
    const petInput = req.body?.pet ?? {};
    const breed = checkCatBreed(petInput.breed);
    const validationError = validateOwnerInput(ownerInput) || breed.error;
    if (validationError) return res.status(422).json({ message: validationError });
    const petFields = pickPetFields(petInput);
    if (petFields.breed !== undefined) petFields.breed = breed.breed;

    let pet;
    await withTransaction(async (session) => {
      const [owner] = await Owner.create([{
        name: ownerInput.name,
        phone: checkMobilePhone(ownerInput.phone).phone,
        landline: ownerInput.landline,
        email: ownerInput.email,
        address: ownerInput.address,
        notes: ownerInput.notes,
        relationVersion: 1,
      }], { session });
      [pet] = await Pet.create([{ ...petFields, ownerId: owner._id }], { session });
    });
    res.status(201).json(pet);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const owner = await Owner.findById(req.params.id);
    if (!owner) return res.status(404).json({ message: '找不到飼主' });
    const pagination = paginationOptions(req.query, {
      defaultLimit: 12,
      maxLimit: 50,
      pageParam: 'petPage',
      limitParam: 'petLimit',
    });
    const filter = { ownerId: owner._id };
    const [pets, total] = await Promise.all([
      Pet.find(filter).sort({ createdAt: -1, _id: -1 }).skip(pagination.skip).limit(pagination.limit),
      Pet.countDocuments(filter),
    ]);
    res.json({ ...owner.toObject(), pets, petPagination: paginationMeta(total, pagination) });
  } catch (err) {
    next(err);
  }
});

// GET /api/owners/:id/attendance — 這位飼主名下所有貓的遲到與未到次數（由掛號即時算，見 lib/attendance.js）。
// 掛號視窗「初診＋既有飼主」用：那時還沒有貓可以查，只能依飼主查。只回次數，逐筆清單在貓咪詳情頁。
router.get('/:id/attendance', async (req, res, next) => {
  try {
    const owner = await Owner.findById(req.params.id).select('_id').lean();
    if (!owner) return res.status(404).json({ message: '找不到飼主' });
    const groups = await Appointment.aggregate(attendanceCountPipeline({ ownerId: owner._id }));
    res.json({ counts: { owner: attendanceCounts(groups) } });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { name, landline, email, address, notes } = req.body;
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return res.status(428).json({ message: '缺少飼主資料版本，請重新整理後再試' });
    }
    const existing = await Owner.findById(req.params.id).select('phone');
    if (!existing) return res.status(404).json({ message: '找不到飼主' });
    const validationError = validateOwnerInput({ name, phone: req.body.phone, email }, existing.phone);
    if (validationError) return res.status(422).json({ message: validationError });
    const phone = checkMobilePhone(req.body.phone, existing.phone).phone;
    const owner = await Owner.findOneAndUpdate(
      { _id: req.params.id, __v: expectedVersion },
      { $set: { name, phone, landline, email, address, notes }, $inc: { __v: 1 } },
      { new: true, runValidators: true }
    );
    if (!owner) {
      const current = await Owner.findById(req.params.id).select('__v');
      if (!current) return res.status(404).json({ message: '找不到飼主' });
      return res.status(409).json({
        message: '飼主資料已被其他分頁更新，已重新載入最新內容，請確認後再修改',
        currentVersion: current.__v,
      });
    }
    res.json(owner);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await withTransaction(async (session) => {
      const owner = await Owner.findById(req.params.id).session(session);
      if (!owner) {
        const error = new Error('找不到飼主');
        error.status = 404;
        throw error;
      }
      if (await Pet.exists({ ownerId: owner._id }).session(session)) {
        const error = new Error('此飼主底下仍有貓咪，請先刪除或轉移貓咪');
        error.status = 409;
        throw error;
      }
      const deleted = await Owner.deleteOne({ _id: owner._id }, { session });
      if (deleted.deletedCount !== 1) {
        const error = new Error('飼主資料正在被其他操作更新，請重新整理後再試');
        error.status = 409;
        throw error;
      }
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
