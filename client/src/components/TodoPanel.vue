<script setup>
import { useClientPagination } from '../composables/useClientPagination';
import { apiErrorMessage } from '../lib/apiError.js';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Check, ChevronDown, CircleSlash, Copy, CornerDownRight, GripVertical, ListTodo, Pencil, Plus, Search, Trash2 } from '@lucide/vue';
import { useTodosStore } from '../stores/todos';
import { usePinnedPetsStore } from '../stores/pinnedPets';
import { useStaffIdentity } from '../composables/useStaffIdentity';
import { useToast } from '../composables/useToast';
import { useCopy } from '../composables/useCopy';
import { clinicDateInput, formatDateTime } from '../lib/datetime';
import { mentionsStillInContent, splitMentionSegments } from '../lib/chatMentions';
import { DUE_TONE_CLASS, TODO_COLORS, dueStatus, todoColor, todoMatches } from '../lib/todoDisplay';
import { dropBeforeId, stepBeforeId } from '../lib/dragReorder';
import { useDragReorder } from '../composables/useDragReorder';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { DatePicker } from './ui/date-picker';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import EmptyState from './EmptyState.vue';
import FilterTabs from './FilterTabs.vue';
import ListSkeleton from './ListSkeleton.vue';
import TodoMentionInput from './TodoMentionInput.vue';
import RichText from './RichText.vue';
import RowActions from './RowActions.vue';
import { richTextToPlain } from '../../../shared/richText.js';

// 院內待辦，放在右側工具欄的「待辦」面板裡（460px 寬，所以新增列與清單都是直排）。
const store = useTodosStore();
const pinned = usePinnedPetsStore();
const { identity } = useStaffIdentity();
const toast = useToast();
const { copyEmail } = useCopy();
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

// 搜尋：未完成的在前端比對（整份都在 store）；已完成的問伺服器，查全部歷史而不只最近 50 筆
// （「上次叫 k/d 是哪天」）。頁籤照樣篩選搜尋結果，數字也換成符合的筆數。
const keyword = ref('');
const searchTerm = ref('');
const searchDone = ref([]);
const searching = computed(() => Boolean(searchTerm.value));
let searchTimer;
let searchSeq = 0;
async function runSearch() {
  const term = searchTerm.value;
  const seq = ++searchSeq;
  if (!term) { searchDone.value = []; return; }
  try {
    const items = await store.searchDone(term);
    if (seq === searchSeq) searchDone.value = items;
  } catch (err) {
    if (seq === searchSeq) toast.error(apiErrorMessage(err, '搜尋失敗，請稍後再試'));
  }
}
watch(keyword, (value) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchTerm.value = value.trim();
    runSearch();
  }, 300);
});
// 清單有異動（這台或另一台）時重查，搜尋結果裡剛完成、剛刪掉的才會跟上。
watch(() => store.items, () => { if (searching.value) runSearch(); });
onBeforeUnmount(() => clearTimeout(searchTimer));

const openSource = computed(() => (searching.value ? store.openItems.filter((item) => todoMatches(item, searchTerm.value)) : store.openItems));
const doneSource = computed(() => (searching.value ? searchDone.value : store.doneItems));

// 「全部」放最左邊（跟藥單面板同一個順序）：未完成照手動順序排在前面，接著是最近完成的。
// 預設仍停在「未完成」——打開面板多半是來做事的。搜尋時第三格查的是全部歷史，標籤改成「已完成」。
const tabs = computed(() => [
  { key: 'all', label: '全部' },
  { key: 'open', label: '未完成' },
  { key: 'done', label: searching.value ? '已完成' : '最近完成' },
]);
const counts = computed(() => ({
  all: openSource.value.length + doneSource.value.length,
  open: openSource.value.length,
  done: doneSource.value.length,
}));
const shown = computed(() => {
  if (view.value === 'open') return openSource.value;
  if (view.value === 'done') return doneSource.value;
  return [...openSource.value, ...doneSource.value];
});

// 清單在前端分頁（store 拿到的已經是整份）；頁碼列由外層面板畫在底部（TodosPanel.vue），所以這裡 expose 出去。
const root = ref(null);
const { page, totalPages, pageItems, goToPage, pageSize } = useClientPagination(shown, { scrollTarget: root });
watch([view, searchTerm], () => { page.value = 1; });
defineExpose({ page, totalPages, goToPage });

// 拖拉排序：只排未完成的（「全部」頁籤裡未完成的也排在前面，一樣能拖）。清單有分頁，只拖得到這一頁；
// 跨頁用把手上的方向鍵一格一格移。順序完全由人決定，期限、顏色都不影響位置。
// 搜尋中不能排：篩過的清單不是連續的一段，拖完不知道該插在完整清單的哪裡。
const sortable = computed(() => !searching.value && view.value !== 'done' && store.openItems.length > 1);
const pageOpenIds = computed(() => pageItems.value.filter((item) => item.status === 'open').map((item) => item._id));
const list = ref(null);
const drag = useDragReorder(list, {
  canStart: () => !busyId.value,
  onDrop: (from, to) => {
    const ids = store.openItems.map((item) => item._id);
    moveTodo(pageOpenIds.value[from], dropBeforeId(ids, pageOpenIds.value, from, to));
  },
});
// 拖到一半另一台改了清單（廣播整份換掉）：這一頁的列已經不是當初量的那些，放棄這次拖拉。
watch(pageOpenIds, (next, prev) => {
  if (drag.dragging.value && next.join() !== prev.join()) drag.cancel();
});

function moveTodo(id, beforeId) {
  return run(id, () => store.move(id, beforeId), '排序失敗，請稍後再試');
}

// 鍵盤一格一格移。移完把焦點留在同一筆的把手上（連按才移得動）；移到別頁時跟著翻過去。
async function stepTodo(item, step) {
  if (busyId.value) return;
  const target = stepBeforeId(store.openItems.map((todo) => todo._id), item._id, step);
  if (!target) return;
  await moveTodo(item._id, target.beforeId);
  const index = shown.value.findIndex((todo) => todo._id === item._id);
  if (index !== -1) page.value = Math.floor(index / pageSize) + 1;
  await nextTick();
  list.value?.querySelector(`[data-todo-handle="${item._id}"]`)?.focus();
}

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
    toast.error(apiErrorMessage(err, fallback));
  } finally {
    busyId.value = '';
  }
}

function toggleDone(item) {
  return run(
    item._id,
    () => (item.status === 'done' ? store.reopen(item._id) : store.complete(item._id, identity.value)),
    '操作失敗，請稍後再試'
  );
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
    toast.error(apiErrorMessage(err, '新增失敗，請稍後再試'));
  } finally {
    adding.value = false;
  }
}

// 只送內文裡還看得到 #名字 的標記——選了之後又把字刪掉，就不該留著連結。
function mentionIds(text, list) {
  return mentionsStillInContent(plain(text), list).map((item) => item.petId);
}

function startEdit(item) {
  cancelProgress();
  editingId.value = item._id;
  editText.value = item.content;
  // 編輯時已被刪除的貓咪（petId 為 null）不能再送回伺服器。
  editMentions.value = (item.mentions ?? []).filter((m) => m.petId).map((m) => ({ petId: String(m.petId), petName: m.petName }));
}

// 已完成的不亮底色：完成了就不再「比較急」，槓掉的內文配彩色底反而搶眼。
const markColor = (item) => (item.status === 'open' ? todoColor(item.color) : null);

// 「⋯」選單：標示顏色（六色，已標的那色不列，另有「取消顏色」）、編輯（只有未完成的）、刪除。處理過程不在這裡——
// 每列最右邊有手風琴的展開鈕。顏色收進選單：標了顏色的整列換成該色淡底，不必常駐一顆按鈕。
function rowActions(item) {
  const open = item.status === 'open';
  return [
    ...(open ? TODO_COLORS.filter((color) => color.key !== item.color).map((color) => ({
      key: `color:${color.key}`, label: `標示${color.label}`, swatch: color.swatch,
    })) : []),
    ...(open && item.color ? [{ key: 'color:', label: '取消顏色', icon: CircleSlash }] : []),
    ...(open ? [{ key: 'edit', label: '編輯', icon: Pencil }] : []),
    { key: 'delete', label: '刪除', icon: Trash2, danger: true, disabled: busyId.value === item._id },
  ];
}

function runRowAction(key, item) {
  if (key.startsWith('color:')) run(item._id, () => store.update(item._id, { color: key.slice('color:'.length) }), '操作失敗，請稍後再試');
  if (key === 'edit') startEdit(item);
  if (key === 'delete') run(item._id, () => store.remove(item._id), '刪除失敗，請稍後再試');
}

// 未完成而寫了處理過程＝處理中（不是另一個 status，只看這欄有沒有字）。
const inProgress = (item) => item.status === 'open' && Boolean(item.progress);

function cancelEdit() {
  editingId.value = '';
  editText.value = '';
  editMentions.value = [];
}

// 處理過程：每列「處理過程」鈕一鍵展開就地編輯（同一時間只開一筆，也不跟編輯內文同時開）。
const progressId = ref('');
const progressText = ref('');
async function toggleProgress(item) {
  if (progressId.value === item._id) return cancelProgress();
  cancelEdit();
  progressId.value = item._id;
  progressText.value = item.progress ?? '';
  await nextTick();
  const field = document.getElementById(`todo-progress-${item._id}`);
  field?.focus();
  // 游標放到最後，接著往下寫（處理過程多半是一行一行累加）。
  field?.setSelectionRange?.(field.value.length, field.value.length);
}
function cancelProgress() {
  progressId.value = '';
  progressText.value = '';
}
async function saveProgress(item) {
  await run(item._id, async () => {
    await store.update(item._id, { progress: progressText.value.trim() });
    cancelProgress();
  }, '儲存失敗，請稍後再試');
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

    <!-- 搜尋內文、處理結果、#貓咪名字；已完成的查全部歷史。 -->
    <div class="relative">
      <Search class="pointer-events-none absolute top-1/2 left-3 size-4.5 -translate-y-1/2 text-subtle-foreground" stroke-width="1.75" aria-hidden="true" />
      <Input v-model="keyword" type="search" class="pl-10" aria-label="搜尋待辦" />
    </div>

    <ListSkeleton v-if="!store.loaded" :rows="3" />
    <EmptyState v-else-if="!shown.length && searching" :icon="ListTodo" title="找不到符合的待辦" inset />
    <EmptyState
      v-else-if="!shown.length"
      :icon="ListTodo"
      :title="EMPTY_TEXT[view].title"
      :description="EMPTY_TEXT[view].description"
      inset
    />
    <!-- 單欄清單：待辦有先後（期限早的在上面），兩欄卡片的 Z 字讀序看不出來。
         列高隨內容，不套 desktop-data-row 的固定 56px——待辦內文最長 500 字，要能完整換行。 -->
    <ul v-else ref="list" class="relative -mx-5 divide-y divide-border border-y border-border">
      <!-- 能排序時左邊多一欄拖拉把手（已完成的列那一格留空，勾選框才對得齊）；被拖的列浮起來、蓋在其他列上面。 -->
      <li
        v-for="item in pageItems"
        :key="item._id"
        class="group grid items-start gap-3 py-3 pr-5"
        :class="[
          sortable ? 'grid-cols-[1.75rem_2rem_minmax(0,1fr)_auto] pl-2' : 'grid-cols-[2rem_minmax(0,1fr)_auto] pl-5',
          markColor(item)?.row ?? '',
          drag.dragging.value?.from === pageOpenIds.indexOf(item._id) ? ['shadow-lg ring-1 ring-border-strong', markColor(item) ? '' : 'bg-card'] : '',
        ]"
        :data-drag-row="sortable && item.status === 'open' ? '' : undefined"
        :style="sortable && item.status === 'open' ? drag.rowStyle(pageOpenIds.indexOf(item._id)) : undefined"
      >
        <!-- 拖拉把手：按住上下拖；鍵盤上 focus 到把手按方向鍵一格一格移（可以跨頁）。
             touch-none 讓平板上手指一拖是排序、不是捲動面板。編輯中的那一列不能拖（輸入框會被拖走）。
             上一次排序還在送時不用 disabled 擋（disabled 會讓鍵盤焦點掉出去、連按方向鍵就斷了），在事件裡擋。 -->
        <template v-if="sortable">
          <button
            v-if="item.status === 'open'"
            type="button"
            :data-todo-handle="item._id"
            class="mt-0.5 flex size-7 touch-none items-center justify-center rounded-md text-subtle-foreground hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-border disabled:pointer-events-none disabled:opacity-40"
            :class="drag.dragging.value ? 'cursor-grabbing' : 'cursor-grab'"
            :disabled="editingId === item._id"
            :aria-label="`調整順序：${plain(item.content)}`"
            v-on="drag.handleEvents(pageOpenIds.indexOf(item._id))"
            @keydown.up.prevent="stepTodo(item, -1)"
            @keydown.down.prevent="stepTodo(item, 1)"
          >
            <GripVertical class="size-5" stroke-width="1.75" />
          </button>
          <span v-else />
        </template>
        <!-- 勾選框：勾起來＝完成（內文槓掉），取消勾選＝改回未完成。狀態以伺服器回來的清單為準，
             所以只綁 model-value、不用 v-model。比表單裡的勾選框大（28px，預設 20px 太難點）；
             mt-0.5 讓框對齊內文第一行。 -->
        <Checkbox
          class="mt-0.5 size-7 justify-self-center rounded-md"
          :model-value="item.status === 'done'"
          :disabled="busyId === item._id"
          :aria-label="`${item.status === 'done' ? '改回未完成' : '完成'}：${plain(item.content)}`"
          @update:model-value="toggleDone(item)"
        >
          <template #indicator><Check class="size-5" stroke-width="3" /></template>
        </Checkbox>

        <!-- 編輯中：輸入框連同右邊按鈕那一欄一起佔滿（格式工具列在輸入框上方，窄了會擠成兩行），
             儲存／取消放在輸入框下面靠右，右邊的選單先收起來。 -->
        <form v-if="editingId === item._id" class="col-span-2 min-w-0 space-y-2" @submit.prevent="saveEdit(item)">
          <TodoMentionInput v-model="editText" v-model:mentions="editMentions" maxlength="500" aria-label="編輯待辦內容" @submit="saveEdit(item)" />
          <div class="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" @click="cancelEdit">取消</Button>
            <Button type="submit" size="sm" :disabled="!plain(editText) || busyId === item._id">儲存</Button>
          </div>
        </form>
        <div v-else class="min-w-0 space-y-0.5">
          <!-- 標籤緊貼標籤寫在同一行：RichText 是 whitespace-pre-wrap，標籤之間多一個換行就會多一個空格。
               RichText 先把粗體／顏色拆成片段，每個片段裡再把 #名字 換成可點的貓咪標籤（點了開病歷速覽）；
               petId 是 null 代表貓咪資料已被刪除，只留下當時的名字、不可點。 -->
          <!-- 「#貓咪名 要寄影像 email」：掛號「上傳影像」帶出來的待辦，飼主 Email（伺服器即時查）接在內文同一行，
               整串字就是複製鈕，點一下複製；同一行放不下時整串換到下一行。 -->
          <div class="flex flex-wrap items-baseline gap-x-2">
          <RichText v-slot="{ text }" tag="p" :text="item.content" class="min-w-0 pt-1 text-base leading-snug" :class="item.status === 'done' ? 'text-muted-foreground line-through' : ''"><template v-for="(segment, index) in splitMentionSegments(text, item.mentions)" :key="index"><button v-if="segment.type === 'mention' && segment.mention.petId" type="button" class="mx-0.5 inline-flex items-center rounded-full bg-accent px-1.5 font-medium text-accent-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-border" v-tip="segment.mention.ownerName ? `飼主：${segment.mention.ownerName}` : undefined" @click="pinned.openQuickView(segment.mention.petId)">#{{ segment.mention.petName }}</button><span v-else-if="segment.type === 'mention'" class="text-muted-foreground" v-tip="'貓咪資料已刪除'">#{{ segment.mention.petName }}</span><template v-else>{{ segment.text }}</template></template></RichText>
          <button
            v-if="item.ownerEmail"
            type="button"
            class="inline-flex max-w-full items-center gap-1.5 rounded-md text-base text-primary hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-border"
            :aria-label="`複製飼主 Email：${item.ownerEmail}`"
            @click="copyEmail(item.ownerEmail)"
          >
            <span class="min-w-0 truncate">{{ item.ownerEmail }}</span>
            <Copy class="size-4 shrink-0" stroke-width="1.75" aria-hidden="true" />
          </button>
          </div>

          <!-- 時間這一行：「處理中」（未完成而寫了處理過程；info＝還在進行的狀態）、期限、建立／完成。 -->
          <p class="flex flex-wrap items-center gap-2 text-xs text-subtle-foreground">
            <Badge v-if="inProgress(item)" variant="status" class="bg-info-surface text-info">處理中</Badge>
            <Badge v-if="item.status === 'open' && dueStatus(item.dueDate, clinicDateInput())" variant="status" :class="DUE_TONE_CLASS[dueStatus(item.dueDate, clinicDateInput()).tone]">{{ dueStatus(item.dueDate, clinicDateInput()).label }}</Badge>
            {{ metaLabel(item) }}
          </p>


          <!-- 已完成的處理過程純展示：不能展開、不能改，直接寫在時間行下面（改回未完成才又能編輯）。 -->
          <p v-if="item.status === 'done' && item.progress" class="flex items-start gap-1.5 pt-1 text-sm text-muted-foreground">
            <CornerDownRight class="mt-0.5 size-4 shrink-0 text-subtle-foreground" stroke-width="1.75" aria-hidden="true" />
            <span class="min-w-0 break-words whitespace-pre-line">{{ item.progress }}</span>
          </p>
        </div>

        <!-- 右邊兩顆：「⋯」（標示顏色、編輯、刪除）與手風琴的展開鈕。展開鈕放最右邊，每一列同一個位置；已完成的沒有展開鈕。 -->
        <div v-if="editingId !== item._id" class="flex shrink-0 items-center gap-1">
          <RowActions :actions="rowActions(item)" :label="`更多操作：${plain(item.content)}`" @select="(key) => runRowAction(key, item)" />
          <Button
            v-if="item.status === 'open'"
            type="button"
            variant="secondary"
            size="icon-sm"
            :aria-expanded="progressId === item._id"
            :aria-controls="`todo-progress-panel-${item._id}`"
            :aria-label="`處理過程：${plain(item.content)}`"
            v-tip="'處理過程'"
            @click="toggleProgress(item)"
          >
            <ChevronDown class="size-4 transition-transform" :class="progressId === item._id ? 'rotate-180' : ''" stroke-width="1.75" />
          </Button>
        </div>

        <!-- 手風琴展開區（一次只開一筆）：從內文那一欄開始、延伸到最右邊，直接就是可編輯的處理過程。
             一行一筆接著寫（「10/12 沒接」「10/13 已回電」）；Ctrl＋Enter 儲存、Esc 收起。 -->
        <form
          v-if="progressId === item._id && item.status === 'open'"
          :id="`todo-progress-panel-${item._id}`"
          class="space-y-2 rounded-lg border border-border bg-sunken p-3"
          :class="sortable ? 'col-start-3 col-end-5' : 'col-start-2 col-end-4'"
          @submit.prevent="saveProgress(item)"
        >
          <Label :for="`todo-progress-${item._id}`">處理過程</Label>
          <Textarea
            :id="`todo-progress-${item._id}`"
            v-model="progressText"
            rows="3"
            maxlength="500"
            class="bg-field"
            @keydown.ctrl.enter.prevent="saveProgress(item)"
            @keydown.meta.enter.prevent="saveProgress(item)"
            @keydown.esc.prevent="cancelProgress"
          />
          <div class="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" @click="cancelProgress">收起</Button>
            <Button type="submit" size="sm" :disabled="busyId === item._id || progressText.trim() === (item.progress ?? '')">儲存</Button>
          </div>
        </form>
      </li>
    </ul>
  </div>
</template>
