import { nextTick, onBeforeUnmount, ref } from 'vue';
import { http } from '../api/http';
import { clinicDateInput } from '../lib/datetime';
import { activeMentionQuery, insertMention, mentionsStillInContent } from '../lib/chatMentions';

// 文字框裡打 # 標記寵物的候選清單邏輯，聊天室與院內待辦共用。
// 被標記的寵物由伺服器依 petId 寫入名字快照，這裡只負責「打 # → 選人 → 把 #名字 塞進內文」。
//
// 候選清單今天有掛號的排前面，再補上全部寵物的搜尋結果——電話裡問的常常是今天沒來的動物。
// 這是選人用的候選清單，不是全站搜尋，所以邊打邊查。
//
//   text            存文字框內容的 ref（v-model 的那一個）
//   getElement      回傳實際的 <input>／<textarea>，讀游標位置用
//   pendingMentions 選過的標記 [{ petId, petName }]；可由外部傳入，讓父元件擁有它（待辦的 v-model:mentions）
let todayPets = null;
let todayPetsDate = '';

async function loadTodayPets() {
  const date = clinicDateInput();
  if (todayPets && todayPetsDate === date) return todayPets;
  try {
    const { data } = await http.get('/appointments', { params: { date } });
    const seen = new Set();
    todayPets = (data.items ?? [])
      .filter((item) => item.petId && !['cancelled', 'no_show'].includes(item.status))
      .filter((item) => !seen.has(String(item.petId)) && seen.add(String(item.petId)))
      .map((item) => ({ petId: String(item.petId), petName: item.petName, ownerName: item.ownerName || '', ownerPhone: item.ownerPhone || '', species: item.species || '', today: true }));
    todayPetsDate = date;
  } catch {
    todayPets = [];
  }
  return todayPets;
}

export function usePetMentionPicker({ text, getElement, pendingMentions = ref([]) }) {
  const mention = ref(null);
  const candidates = ref([]);
  const highlighted = ref(0);
  let searchTimer;
  let searchRequest = 0;

  function closeMention() {
    mention.value = null;
    candidates.value = [];
    clearTimeout(searchTimer);
    searchRequest += 1;
  }

  function updateMention() {
    const el = getElement();
    const next = el ? activeMentionQuery(el.value, el.selectionStart) : null;
    if (!next) return closeMention();
    if (mention.value?.start === next.start && mention.value?.query === next.query) return;
    mention.value = next;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => searchCandidates(next.query), 250);
  }

  async function searchCandidates(query) {
    const token = ++searchRequest;
    const keyword = query.trim().toLowerCase();
    const [today, searched] = await Promise.all([
      loadTodayPets(),
      keyword
        ? http.get('/pets', { params: { q: query.trim(), limit: 8 } }).then(({ data }) => data.items ?? []).catch(() => [])
        : Promise.resolve([]),
    ]);
    if (token !== searchRequest) return;
    const matchedToday = today.filter((pet) => !keyword || pet.petName.toLowerCase().includes(keyword) || pet.ownerName.toLowerCase().includes(keyword) || pet.ownerPhone.includes(keyword));
    const todayIds = new Set(matchedToday.map((pet) => pet.petId));
    const others = searched
      .filter((pet) => !todayIds.has(String(pet._id)))
      .map((pet) => ({ petId: String(pet._id), petName: pet.name, ownerName: pet.ownerId?.name || '', ownerPhone: pet.ownerId?.phone || '', species: pet.species || '', today: false }));
    candidates.value = [...matchedToday, ...others].slice(0, 8);
    highlighted.value = 0;
  }

  async function selectCandidate(candidate) {
    const el = getElement();
    if (!el || !mention.value || !candidate) return;
    const result = insertMention(text.value, mention.value.start, el.selectionStart, candidate.petName);
    text.value = result.text;
    pendingMentions.value = [...pendingMentions.value, { petId: candidate.petId, petName: candidate.petName }];
    closeMention();
    await nextTick();
    el.focus();
    el.setSelectionRange(result.caret, result.caret);
  }

  // 回傳 true 代表這個按鍵已經被候選清單吃掉（上下選、Enter／Tab 選人、Esc 關閉），
  // 呼叫端就不要再當成送出處理。中文輸入法選字時的 Enter 不算。
  function handleKeydown(event) {
    if (!mention.value) return false;
    if (candidates.value.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        highlighted.value = (highlighted.value + step + candidates.value.length) % candidates.value.length;
        return true;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        selectCandidate(candidates.value[highlighted.value]);
        return true;
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMention();
      return true;
    }
    return false;
  }

  // 送出時只帶內文裡還看得到 #名字 的標記。
  function mentionIdsIn(content) {
    return mentionsStillInContent(content, pendingMentions.value).map((item) => item.petId);
  }

  function reset() {
    pendingMentions.value = [];
    closeMention();
  }

  onBeforeUnmount(() => clearTimeout(searchTimer));

  return { mention, candidates, highlighted, pendingMentions, updateMention, closeMention, selectCandidate, handleKeydown, mentionIdsIn, reset };
}
