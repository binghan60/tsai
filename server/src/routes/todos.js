import { Router } from 'express';
import mongoose from 'mongoose';
import Todo from '../models/Todo.js';
import { MAX_MENTIONS, STAFF_SENDERS } from '../lib/pinnedPets.js';
import { mentionSnapshots, parseMentionIds } from '../lib/petMentions.js';
import { isValidDateInput, listTodos, publishTodos } from '../lib/todos.js';
import { normalizeRichText, richTextLength, richTextToPlain } from '../../../shared/richText.js';

const router = Router();

function invalid(res, message) {
  return res.status(422).json({ message });
}

// 待辦內文可以上色、加粗（shared/richText.js）：存前標準化；空白與 500 字的判斷看純文字，
// 只剩格式標記的內容算空白，標記本身也不佔字數。回傳 { content } 或 { error }。
function cleanContent(value) {
  const content = normalizeRichText(String(value ?? '')).trim();
  if (!richTextToPlain(content).trim()) return { error: '待辦內容不可為空' };
  if (richTextLength(content) > 500) return { error: '待辦內容最多 500 字' };
  return { content };
}

// 把 body.mentions（petId 陣列）換成寫進文件的快照。出錯時回 { error: [status, message] }。
async function resolveMentions(value) {
  const ids = parseMentionIds(value);
  if (!ids) return { error: [422, `標記的寵物格式不正確（一則待辦最多 ${MAX_MENTIONS} 隻）`] };
  const mentions = await mentionSnapshots(ids);
  if (!mentions) return { error: [422, '標記的寵物不存在，可能已被刪除'] };
  return { mentions };
}

router.get('/', async (req, res, next) => {
  try {
    res.json({ items: await listTodos() });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const createdBy = req.body?.createdBy;
    if (!STAFF_SENDERS.includes(createdBy)) return invalid(res, '身分參數不正確');
    const { content, error: contentError } = cleanContent(req.body?.content);
    if (contentError) return invalid(res, contentError);

    const dueDate = req.body?.dueDate || null;
    if (dueDate !== null && !isValidDateInput(String(dueDate))) return invalid(res, '期限日期格式不正確');

    const { mentions, error } = await resolveMentions(req.body?.mentions);
    if (error) return res.status(error[0]).json({ message: error[1] });

    await Todo.create({ content, createdBy, dueDate, mentions });
    res.status(201).json({ items: await publishTodos() });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return invalid(res, '待辦參數不正確');
    const todo = await Todo.findById(req.params.id);
    if (!todo) return res.status(404).json({ message: '找不到待辦，可能已被刪除' });

    const body = req.body ?? {};
    if (body.content !== undefined) {
      const { content, error: contentError } = cleanContent(body.content);
      if (contentError) return invalid(res, contentError);
      todo.content = content;
    }
    if (body.dueDate !== undefined) {
      const dueDate = body.dueDate || null;
      if (dueDate !== null && !isValidDateInput(String(dueDate))) return invalid(res, '期限日期格式不正確');
      todo.dueDate = dueDate;
    }
    // mentions 帶了就整組取代（前端改內文時會把還留在內文裡的標記一起送回來）；沒帶則不動。
    if (body.mentions !== undefined) {
      const { mentions, error } = await resolveMentions(body.mentions);
      if (error) return res.status(error[0]).json({ message: error[1] });
      todo.mentions = mentions;
    }

    await todo.save();
    res.json({ items: await publishTodos() });
  } catch (err) {
    next(err);
  }
});

// 完成與重開都是冪等的：兩台裝置同時按，後到的一台照樣拿到最新清單，不報錯。
router.post('/:id/complete', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return invalid(res, '待辦參數不正確');
    const doneBy = req.body?.doneBy;
    if (!STAFF_SENDERS.includes(doneBy)) return invalid(res, '身分參數不正確');
    const todo = await Todo.findById(req.params.id);
    if (!todo) return res.status(404).json({ message: '找不到待辦，可能已被刪除' });
    if (todo.status !== 'done') {
      todo.status = 'done';
      todo.doneAt = new Date();
      todo.doneBy = doneBy;
      await todo.save();
    }
    res.json({ items: await publishTodos() });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/reopen', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return invalid(res, '待辦參數不正確');
    const todo = await Todo.findById(req.params.id);
    if (!todo) return res.status(404).json({ message: '找不到待辦，可能已被刪除' });
    if (todo.status !== 'open') {
      todo.status = 'open';
      todo.doneAt = null;
      todo.doneBy = null;
      await todo.save();
    }
    res.json({ items: await publishTodos() });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return invalid(res, '待辦參數不正確');
    // 已經被另一台刪掉也算成功——使用者要的結果就是它不在清單裡。
    await Todo.deleteOne({ _id: req.params.id });
    res.json({ items: await publishTodos() });
  } catch (err) {
    next(err);
  }
});

export default router;
