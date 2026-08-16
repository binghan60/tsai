import { ref } from 'vue';
import { http } from '../api/http';

// 醫師自己累積的常用評語。整份資料很小，開表單時抓一次就快取在模組層級，
// 之後每個欄位都從記憶體裡篩，不再打 API。
const phrases = ref([]);
const loaded = ref(false);
let inflight = null;

// 待刪除的那一筆。常用語按鈕每個文字欄位都有一組，確認對話框卻只需要一個 ——
// 狀態放在模組層級，由表單頁掛一次的 QuickPhraseDeleteDialog 負責渲染。
const pendingDelete = ref(null);

// 「看全部」的挑選視窗同理，只掛一個。欄位那邊只放得下前幾句，
// 其餘的靠這個視窗才點得到 —— 存進來的 onPick 負責把選中的句子寫回原欄位。
const picker = ref(null);

// 用得多的排前面；次數相同時新的排前面。
function compare(a, b) {
  if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount;
  return String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''));
}

export function useQuickPhrases() {
  async function loadPhrases({ force = false } = {}) {
    if (loaded.value && !force) return phrases.value;
    if (!inflight) {
      inflight = http.get('/quick-phrases')
        .then(({ data }) => {
          phrases.value = Array.isArray(data) ? data : [];
          loaded.value = true;
          return phrases.value;
        })
        // 常用語只是輔助輸入，抓不到不該讓整張表單開不起來。
        .catch(() => {
          phrases.value = [];
          return phrases.value;
        })
        .finally(() => { inflight = null; });
    }
    return inflight;
  }

  function phrasesFor(itemKey) {
    return phrases.value.filter((entry) => entry.itemKey === itemKey).sort(compare);
  }

  async function addPhrase(text, itemKey) {
    const { data } = await http.post('/quick-phrases', { text, itemKey });
    const index = phrases.value.findIndex((entry) => entry._id === data._id);
    if (index >= 0) phrases.value.splice(index, 1, data);
    else phrases.value.push(data);
    return data;
  }

  async function removePhrase(id) {
    await http.delete(`/quick-phrases/${id}`);
    phrases.value = phrases.value.filter((entry) => entry._id !== id);
  }

  function openPicker(context) {
    picker.value = context;
  }

  function closePicker() {
    picker.value = null;
  }

  function requestRemove(phrase) {
    pendingDelete.value = phrase;
  }

  function cancelRemove() {
    pendingDelete.value = null;
  }

  // 刪除失敗時故意不清掉 pendingDelete —— 對話框留在原地，使用者才知道沒刪成功。
  async function confirmRemove() {
    const phrase = pendingDelete.value;
    if (!phrase) return;
    await removePhrase(phrase._id);
    pendingDelete.value = null;
  }

  // 射後不理：次數只影響排序，失敗了不值得打斷填表，也不值得跳錯誤訊息。
  function markUsed(phrase) {
    if (!phrase?._id) return;
    phrase.usageCount = (phrase.usageCount ?? 0) + 1;
    http.post(`/quick-phrases/${phrase._id}/use`).catch(() => {});
  }

  return {
    phrases, loadPhrases, phrasesFor, addPhrase, markUsed,
    pendingDelete, requestRemove, cancelRemove, confirmRemove,
    picker, openPicker, closePicker,
  };
}
