import { Router } from 'express';
import Owner from '../models/Owner.js';
import Pet from '../models/Pet.js';
import { escapeRegExp } from '../lib/regex.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const query = String(req.query.q ?? '').trim();
    if (!query) return res.json({ owners: [], pets: [] });

    const pattern = new RegExp(escapeRegExp(query), 'i');
    const owners = await Owner.find({
      $or: [{ name: pattern }, { phone: pattern }, { landline: pattern }, { email: pattern }],
    })
      .sort({ updatedAt: -1 })
      .limit(8);

    const matchingOwnerIds = owners.map((owner) => owner._id);
    const pets = await Pet.find({
      $or: [
        { name: pattern },
        ...(matchingOwnerIds.length ? [{ ownerId: { $in: matchingOwnerIds } }] : []),
      ],
    })
      .sort({ updatedAt: -1 })
      .limit(12)
      .populate('ownerId', 'name phone');

    res.json({ owners, pets });
  } catch (err) {
    next(err);
  }
});

export default router;
