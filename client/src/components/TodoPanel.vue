<script setup>
import { computed, ref, watch } from 'vue';
import { Check, ListTodo, Pencil, Plus, Trash2, Undo2, X } from '@lucide/vue';
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

// 院內待辦，放在右側工具欄的「待辦」面板裡（460px 寬，所以新增列與清單都是直排）。
const store = useTodosStore();
const pinned = usePinnedPetsStore();
const { identity } = useStaffIdentity();
const toast = useToast();
// KeepAlive 會讓面板跨日掛著，「今天」每次用到才算，不在掛載時存一份。
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

// 清單在前端分頁（store 拿到的已經是整份）；頁碼列由外層面板畫在底部（TodosPanel.vue），所以這裡 expose 出去。
const PAGE_SIZE = 20;
const root = ref(null);
const page = ref(1);
const totalPages = computed(() => Math.max(1, Math.ceil(shown.value.length / PAGE_SIZE)));
const pageItems = computed(() => shown.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
watch(view, () => { page.value = 1; });
// 完成／刪除讓最後一頁空掉時退回新的最後一頁。
watch(totalPages, (value) => { if (page.value > value) page.value = value; });
function goToPage(value) {
  page.value = value;
  root.value?.scrollIntoView({ block: 'start' });
}
defineExpose({ page, totalPages, goToPage });
const EMPTY_TEXT = {
  all: { title: '還沒有任何待辦', description: '在上面輸入就能新增，打 # 可以標記貓咪，兩邊的電腦會即時同步' },
  open: { title: '沒有未完成的待辦', description: '在上面輸入就能新增，打 # 可以標記貓咪，兩邊的電腦會即時同步' },
  done: { title: '還沒有完成的待辦', description: '只保留最近 50 筆' },
};

function staffLabel(value) {
  return value === 'front_desk' ? '櫃台' : '醫師';
}

// 待辦會跨日留著，不是今天的要帶日期，否則「09:30」看不出是哪一天。
function stamp(value) {
  return formatDateTime(value, clinicDateInput(value) === clinicDateInput() ? timeOptions : dateTimeOptions);
}

function metaLabel(item) {
  return item.status === 'done'
    ? `${staffLabel(item.doneBy)}完成　${stamp(item.doneAt)}`
    : `${staffLabel(item.createdBy)}建立　${stamp(item.createdAt)}`;
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
  // 編輯時已被刪除的貓咪（petId 為 null）不能再送回伺服器。
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
  <div ref="root" class="space-y-4">
    <form class="space-y-2" @submit.prevent="submit">
      <TodoMentionInput v-model="content" v-model:mentions="mentions" placeholder="要做的事，打 # 可以標記貓咪" aria-label="待辦內容" maxlength="500" @submit="submit" />
      <div class="flex items-center gap-2">
        <DatePicker v-model="dueDate" class="min-w-0 flex-1" placeholder="期限" aria-label="期限" />
        <Button type="submit" :disabled="!plain(content) || adding"><Plus stroke-width="1.75" />新增</Button>
      </div>
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
    <ul v-else class="-mx-5 divide-y divide-border border-y border-border">
      <li v-for="item in pageItems" :key="item._id" class="group grid grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-3 px-5 py-3">
        <Button
          v-if="item.status === 'open'"
          type="button"
          variant="soft"
          size="icon-xs"
          class="rounded-full"
          :disabled="busyId === item._id"
          :aria-label="`完成：${plain(item.content)}`"
          @click="run(item._id, () => store.complete(item._id, identity), '操作失敗，請稍後再試')"
        >
          <!-- 按鈕本身就是那個空心圓；滑過才出勾勾，靜止時不會被誤讀成已完成。 -->
          <Check class="size-4 opacity-0 transition-opacity group-hover/button:opacity-100" stroke-width="2" />
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
               RichText 先把粗體／顏色拆成片段，每個片段裡再把 #名字 換成可點的貓咪標籤（點了開病歷速覽）；
               petId 是 null 代表貓咪資料已被刪除，只留下當時的名字、不可點。 -->
          <RichText v-else v-slot="{ text }" tag="p" :text="item.content" class="pt-1 text-base leading-snug" :class="item.status === 'done' ? 'text-muted-foreground line-through' : ''"><template v-for="(segment, index) in splitMentionSegments(text, item.mentions)" :key="index"><button v-if="segment.type === 'mention' && segment.mention.petId" type="button" class="mx-0.5 inline-flex items-center rounded-full bg-accent px-1.5 font-medium text-accent-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" v-tip="segment.mention.ownerName ? `飼主：${segment.mention.ownerName}` : undefined" @click="pinned.openQuickView(segment.mention.petId)">#{{ segment.mention.petName }}</button><span v-else-if="segment.type === 'mention'" class="text-muted-foreground" v-tip="'貓咪資料已刪除'">#{{ segment.mention.petName }}</span><template v-else>{{ segment.text }}</template></template></RichText>

          <p class="flex flex-wrap items-center gap-2 text-xs text-subtle-foreground">
            <Badge v-if="item.status === 'open' && dueStatus(item.dueDate, clinicDateInput())" variant="status" :class="DUE_TONE_CLASS[dueStatus(item.dueDate, clinicDateInput()).tone]">{{ dueStatus(item.dueDate, clinicDateInput()).label }}</Badge>
            {{ metaLabel(item) }}
          </p>
        </div>

        <div class="flex shrink-0 items-center gap-1">
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
