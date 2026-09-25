<script setup>
import { computed, ref } from 'vue';
import { Check, Circle, ListTodo, Pencil, Plus, Trash2, Undo2, X } from '@lucide/vue';
import { useTodosStore } from '../stores/todos';
import { usePinnedPetsStore } from '../stores/pinnedPets';
import { useStaffIdentity } from '../composables/useStaffIdentity';
import { useToast } from '../composables/useToast';
import { clinicDateInput, formatDateTime } from '../lib/datetime';
import { mentionsStillInContent, splitMentionSegments } from '../lib/chatMentions';
import { DUE_TONE_CLASS, dueStatus } from '../lib/todoDisplay';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { DatePicker } from './ui/date-picker';
import EmptyState from './EmptyState.vue';
import FilterTabs from './FilterTabs.vue';
import ListSkeleton from './ListSkeleton.vue';
import TodoMentionInput from './TodoMentionInput.vue';
import RichText from './RichText.vue';
import { richTextToPlain } from '../../../shared/richText.js';

// 院內待辦面板，診療台與櫃台共用，內容整個放在頁首「待辦」chip 開的 ModalDialog 裡。
// 面板只在開著的時候才掛載，所以 today 每次打開都是新的。
const store = useTodosStore();
const pinned = usePinnedPetsStore();
const { identity } = useStaffIdentity();
const toast = useToast();
const today = clinicDateInput();
const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false };
const dateTimeOptions = { month: 'numeric', day: 'numeric', ...timeOptions };

const view = ref('open');
const content = ref('');
const dueDate = ref('');
const mentions = ref([]);
const adding = ref(false);
const busyId = ref('');
const editingId = ref('');
const editText = ref('');
const editMentions = ref([]);

// 「全部」放最左邊（跟藥單面板同一個順序）：未完成照期限排在前面，接著是最近完成的。
// 預設仍停在「未完成」——打開面板多半是來做事的。
const tabs = [
  { key: 'all', label: '全部' },
  { key: 'open', label: '未完成' },
  { key: 'done', label: '最近完成' },
];
const counts = computed(() => ({
  all: store.openItems.length + store.doneItems.length,
  open: store.openItems.length,
  done: store.doneItems.length,
}));
const shown = computed(() => {
  if (view.value === 'open') return store.openItems;
  if (view.value === 'done') return store.doneItems;
  return [...store.openItems, ...store.doneItems];
});
const EMPTY_TEXT = {
  all: { title: '還沒有任何待辦', description: '在上面輸入就能新增，打 # 可以標記寵物，兩邊的電腦會即時同步' },
  open: { title: '沒有未完成的待辦', description: '在上面輸入就能新增，打 # 可以標記寵物，兩邊的電腦會即時同步' },
  done: { title: '還沒有完成的待辦', description: '只保留最近 50 筆' },
};

function staffLabel(value) {
  return value === 'front_desk' ? '櫃台' : '醫生';
}

// 待辦會跨日留著，不是今天的要帶日期，否則「09:30」看不出是哪一天。
function stamp(value) {
  return formatDateTime(value, clinicDateInput(value) === today ? timeOptions : dateTimeOptions);
}

function metaLabel(item) {
  return item.status === 'done'
    ? `${staffLabel(item.doneBy)}完成 · ${stamp(item.doneAt)}`
    : `${staffLabel(item.createdBy)}建立 · ${stamp(item.createdAt)}`;
}

// 所有動作共用的包裝：同一時間只處理一筆，失敗才跳提示（成功的畫面變化本身就是回饋）。
async function run(id, action, fallback) {
  if (busyId.value) return;
  busyId.value = id;
  try {
    await action();
  } catch (err) {
    toast.error(err.response?.data?.message || fallback);
  } finally {
    busyId.value = '';
  }
}

// 內文可以上色、加粗（shared/richText.js）。空白判斷、#標記比對、aria-label 一律看純文字。
const plain = (value) => richTextToPlain(value).trim();

async function submit() {
  const text = content.value.trim();
  if (!plain(text) || adding.value) return;
  adding.value = true;
  try {
    await store.add({ content: text, createdBy: identity.value, dueDate: dueDate.value, mentions: mentionIds(text, mentions.value) });
    content.value = '';
    dueDate.value = '';
    mentions.value = [];
    // 新增的一定是未完成；停在「最近完成」會看不到它，停在「全部」就留著。
    if (view.value === 'done') view.value = 'open';
  } catch (err) {
    toast.error(err.response?.data?.message || '新增失敗，請稍後再試');
  } finally {
    adding.value = false;
  }
}

// 只送內文裡還看得到 #名字 的標記——選了之後又把字刪掉，就不該留著連結。
function mentionIds(text, list) {
  return mentionsStillInContent(plain(text), list).map((item) => item.petId);
}

function startEdit(item) {
  editingId.value = item._id;
  editText.value = item.content;
  // 編輯時已被刪除的寵物（petId 為 null）不能再送回伺服器。
  editMentions.value = (item.mentions ?? []).filter((m) => m.petId).map((m) => ({ petId: String(m.petId), petName: m.petName }));
}

function cancelEdit() {
  editingId.value = '';
  editText.value = '';
  editMentions.value = [];
}

async function saveEdit(item) {
  const text = editText.value.trim();
  if (!plain(text)) return;
  await run(item._id, async () => {
    await store.update(item._id, { content: text, mentions: mentionIds(text, editMentions.value) });
    cancelEdit();
  }, '儲存失敗，請稍後再試');
}
</script>

<template>
  <div class="max-h-[min(68vh,48rem)] min-h-72 space-y-4 overflow-y-auto p-5 sm:p-6">
    <form class="flex flex-wrap items-start gap-2" @submit.prevent="submit">
      <TodoMentionInput v-model="content" v-model:mentions="mentions" class="min-w-56 flex-1" placeholder="要做的事，打 # 可以標記寵物" aria-label="待辦內容" maxlength="500" @submit="submit" />
      <DatePicker v-model="dueDate" class="w-40" placeholder="期限（選填）" aria-label="期限" />
      <Button type="submit" :disabled="!plain(content) || adding"><Plus class="h-4 w-4" stroke-width="1.75" />新增</Button>
    </form>

    <FilterTabs v-model="view" :items="tabs" :counts="counts" aria-label="待辦狀態" />

    <ListSkeleton v-if="!store.loaded" :rows="3" />
    <EmptyState
      v-else-if="!shown.length"
      :icon="ListTodo"
      :title="EMPTY_TEXT[view].title"
      :description="EMPTY_TEXT[view].description"
      inset
    />
    <!-- 單欄清單：待辦有先後（期限早的在上面），兩欄卡片的 Z 字讀序看不出來。
         列高隨內容，不套 desktop-data-row 的固定 56px——待辦內文最長 500 字，要能完整換行。 -->
    <ul v-else class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      <li v-for="item in shown" :key="item._id" class="grid min-h-14 grid-cols-[2.25rem_minmax(0,1fr)_7rem_auto] items-center gap-3 px-4 py-2.5">
        <Button
          v-if="item.status === 'open'"
          type="button"
          variant="secondary"
          size="icon-xs"
          :disabled="busyId === item._id"
          :aria-label="`完成：${plain(item.content)}`"
          @click="run(item._id, () => store.complete(item._id, identity), '操作失敗，請稍後再試')"
        >
          <Circle class="h-4 w-4" stroke-width="1.75" />
        </Button>
        <Button
          v-else
          type="button"
          variant="secondary"
          size="icon-xs"
          :disabled="busyId === item._id"
          :aria-label="`改回未完成：${plain(item.content)}`"
          @click="run(item._id, () => store.reopen(item._id), '操作失敗，請稍後再試')"
        >
          <Undo2 class="h-4 w-4" stroke-width="1.75" />
        </Button>

        <div class="min-w-0 space-y-0.5">
          <form v-if="editingId === item._id" class="flex items-center gap-1.5" @submit.prevent="saveEdit(item)">
            <TodoMentionInput v-model="editText" v-model:mentions="editMentions" class="min-w-0 flex-1" maxlength="500" aria-label="編輯待辦內容" @submit="saveEdit(item)" />
            <Button type="submit" variant="secondary" size="icon-xs" :disabled="!plain(editText) || busyId === item._id" aria-label="儲存"><Check class="h-4 w-4" stroke-width="1.75" /></Button>
            <Button type="button" variant="secondary" size="icon-xs" aria-label="取消編輯" @click="cancelEdit"><X class="h-4 w-4" stroke-width="1.75" /></Button>
          </form>
          <!-- 標籤緊貼標籤寫在同一行：RichText 是 whitespace-pre-wrap，標籤之間多一個換行就會多一個空格。
               RichText 先把粗體／顏色拆成片段，每個片段裡再把 #名字 換成可點的寵物標籤（點了開病歷速覽）；
               petId 是 null 代表寵物資料已被刪除，只留下當時的名字、不可點。 -->
          <RichText v-else v-slot="{ text }" tag="p" :text="item.content" class="text-sm leading-snug" :class="item.status === 'done' ? 'text-muted-foreground line-through' : ''"><template v-for="(segment, index) in splitMentionSegments(text, item.mentions)" :key="index"><button v-if="segment.type === 'mention' && segment.mention.petId" type="button" class="mx-0.5 inline-flex items-center rounded-full bg-accent px-1.5 font-medium text-accent-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" :title="segment.mention.ownerName ? `飼主：${segment.mention.ownerName}` : undefined" @click="pinned.openQuickView(segment.mention.petId)">#{{ segment.mention.petName }}</button><span v-else-if="segment.type === 'mention'" class="text-muted-foreground" title="寵物資料已刪除">#{{ segment.mention.petName }}</span><template v-else>{{ segment.text }}</template></template></RichText>

          <p class="text-xs text-muted-foreground">{{ metaLabel(item) }}</p>
        </div>

        <span class="flex justify-end">
          <Badge v-if="item.status === 'open' && dueStatus(item.dueDate, today)" variant="status" :class="DUE_TONE_CLASS[dueStatus(item.dueDate, today).tone]">{{ dueStatus(item.dueDate, today).label }}</Badge>
        </span>

        <div class="flex shrink-0 items-center gap-1.5">
          <Button v-if="item.status === 'open' && editingId !== item._id" type="button" variant="secondary" size="icon-xs" :aria-label="`編輯：${plain(item.content)}`" @click="startEdit(item)">
            <Pencil class="h-4 w-4" stroke-width="1.75" />
          </Button>
          <Button type="button" variant="destructive" size="icon-xs" :disabled="busyId === item._id" :aria-label="`刪除：${plain(item.content)}`" @click="run(item._id, () => store.remove(item._id), '刪除失敗，請稍後再試')">
            <Trash2 class="h-4 w-4" stroke-width="1.75" />
          </Button>
        </div>
      </li>
    </ul>
  </div>
</template>
