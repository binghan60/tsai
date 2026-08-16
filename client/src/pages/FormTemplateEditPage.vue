<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  CircleDot,
  ChevronUp,
  Eye,
  FlaskConical,
  Gauge,
  Hash,
  Info,
  LayoutList,
  List,
  MousePointerClick,
  Plus,
  Save,
  SquareCheck,
  Stethoscope,
  TextAlignStart,
  Trash2,
  Type,
  X,
} from '@lucide/vue';
import { onBeforeRouteLeave, useRoute } from 'vue-router';
import { http } from '../api/http';
import { useFormTemplate } from '../composables/useFormTemplate';
import { useToast } from '../composables/useToast';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import FormSectionPreview from '../components/formfields/FormSectionPreview.vue';

const route = useRoute();
const toast = useToast();
const { clearTemplateCache } = useFormTemplate();

const currentId = ref(route.params.id);
const currentName = ref('');
const currentDescription = ref('');
const currentSpecies = ref('all');
const sections = ref([]);
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const activeKey = ref('');
const activeView = ref('design');
const savedSnapshot = ref('');

const selectedItemKey = ref(null);
const sectionToDelete = ref(null);
const pendingRoleRemoval = ref(null);

const PRESENTATION_OPTIONS = [
  { value: 'keyValue', title: '欄位清單', hint: '一般欄位並排，適合基本資料。' },
  { value: 'grid', title: '量測格狀', hint: '數值卡片，可搭配參考範圍。' },
  { value: 'findings', title: '理學檢查', hint: '正常、異常與未檢查的狀態切換。' },
  { value: 'table', title: '檢驗表格', hint: '數值、參考值與備註，可依項目分組。' },
  { value: 'prose', title: '長文段落', hint: '多行文字，適合結論與照護建議。' },
];

// 工具箱的每一格。型別不再藏在「進階設定」的下拉選單裡 —— 使用者是先挑欄位種類，
// 再把它放進區塊，這才是實際的思考順序。
const TYPE_META = {
  text: { title: '單行文字', icon: Type, hint: '姓名、編號這類短文字' },
  textarea: { title: '多行文字', icon: TextAlignStart, hint: '可換行的長段落' },
  number: { title: '數字', icon: Hash, hint: '只接受數值' },
  date: { title: '日期', icon: Calendar, hint: '日期選擇器' },
  select: { title: '下拉選單', icon: List, hint: '收合成一列，選項多時用' },
  radio: { title: '單選', icon: CircleDot, hint: '選項全部列出，只能挑一個' },
  checkbox: { title: '複選', icon: SquareCheck, hint: '選項全部列出，可以複選' },
  measurement: { title: '量測值', icon: Gauge, hint: '數值卡片，可自動判讀' },
  finding: { title: '檢查結果', icon: Stethoscope, hint: '正常／異常／未檢查' },
  lab: { title: '檢驗項目', icon: FlaskConical, hint: '數值＋參考範圍＋備註' },
};

// 一般欄位到哪個版式都能用 —— 各版式的「非主型別」項目最後都是交給
// ScalarField 渲染，沒有任何版式撐不住其中某一種的理由。
const GENERAL_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'radio', 'checkbox'];

// 主型別則綁死在版式上：measurement／finding／lab 要靠各自的版式元件才畫得出
// 狀態切換、參考範圍與分組表格，放進別種版式只會被當成普通文字框。
// 這三種都是「從固定選項裡挑」，差別只在呈現方式，共用同一份選項設定。
const OPTION_TYPES = new Set(['select', 'radio', 'checkbox']);

const SPAN_OPTIONS = [
  { value: 'auto', title: '自動', hint: '跟著版式的預設欄寬' },
  { value: 'wide', title: '加寬', hint: '佔兩格' },
  { value: 'full', title: '整排', hint: '獨佔一整排' },
];

// 理學檢查與檢驗表格的主要列是固定欄位的表格（項目／狀態／數值／備註），
// 單列寬度不是可調的概念；長文段落的長文字本來就一行一個。
const ROW_PRESENTATIONS = new Set(['findings', 'table', 'prose']);

function spanApplies(section, item) {
  if (!section || !item) return false;
  if (!ROW_PRESENTATIONS.has(section.presentation)) return true;
  return item.type !== LAYOUT_TYPE[section.presentation];
}

// 這個版式的主體是哪一種型別 —— 決定該項目走版式自己的排版（表格列、長文堆疊）
// 還是接在尾端的一般網格。純結構判斷，跟工具箱怎麼排無關。
const LAYOUT_TYPE = {
  keyValue: null,
  grid: 'measurement',
  findings: 'finding',
  table: 'lab',
  prose: 'textarea',
};

// 每個區塊的工具箱內容完全相同 —— 任何型別都能放進任何區塊，
// 版式只決定它「原生」的排法，非原生的型別由 FieldControl 用精簡控制項渲染。
const TOOLBOX_GROUPS = [
  { title: '檢查專用', types: ['measurement', 'finding', 'lab'] },
  { title: '一般欄位', types: GENERAL_TYPES },
];
const ALL_TYPES = TOOLBOX_GROUPS.flatMap((group) => group.types);

// 只用來加一圈外框，提示「這個區塊的版式是為這種型別設計的」，不影響可選範圍。
const FEATURED_TYPE = {
  grid: 'measurement',
  findings: 'finding',
  table: 'lab',
};

// 這幾個欄位除了填寫之外還會影響別的地方。說明只講「會發生什麼事」，
// 不解釋它在系統裡叫什麼 —— 第一次打開表單設計器的人不需要知道那些。
const ROLE_HINTS = {
  vet: '這裡填的醫師姓名會印在報告最上方。',
  visitDate: '這個日期會印在報告最上方，報告列表也依它排序。',
  weight: '結案時會把這裡的數值存回寵物資料的最近體重。',
  conclusion: '結案前，這欄和「照護與追蹤建議」至少要填一個。',
  treatmentPlan: '結案前，這欄和「結論」至少要填一個。',
};

const activeSection = computed(() =>
  sections.value.find((section) => section.key === activeKey.value) ?? null
);
const selectedItem = computed(() =>
  (activeSection.value?.items ?? []).find((item) => item.key === selectedItemKey.value) ?? null
);
const selectedIndex = computed(() =>
  selectedItem.value ? (activeSection.value?.items ?? []).indexOf(selectedItem.value) : -1
);
const visibleSections = computed(() =>
  sections.value.filter((section) => section.enabled !== false && section.items?.some((item) => item.enabled !== false))
);
const featuredType = computed(() => FEATURED_TYPE[activeSection.value?.presentation] ?? null);
const typesForSelected = computed(() => {
  const item = selectedItem.value;
  if (!item) return [];
  // 舊資料若帶了不在清單裡的型別也要保留，否則會卡在一個選不回去的狀態。
  return [...new Set([...ALL_TYPES, item.type])];
});
const labGroupsOf = (section) =>
  (section?.items ?? []).filter((item) => item.type === 'lab').map((item) => item.group).filter(Boolean);

// 新增檢驗項目時沿用的分組，只能看同一個區塊 —— 跨區塊沿用會拿到不相干的分組。
const sectionGroups = computed(() => [...new Set(labGroupsOf(activeSection.value))]);

// 但建議清單要涵蓋整份範本：分組是純文字比對，只提示同區塊等於換個區塊就得重打，
// 打錯一個字就會多出一組。同區塊的排前面，最常沿用的仍然最好按。
const labGroupOptions = computed(() => [
  ...new Set([...sectionGroups.value, ...sections.value.flatMap(labGroupsOf)]),
]);

const editorPayload = computed(() => ({
  name: currentName.value,
  description: currentDescription.value,
  species: currentSpecies.value,
  sections: sections.value,
}));
const isDirty = computed(() =>
  !loading.value && JSON.stringify(editorPayload.value) !== savedSnapshot.value
);

function markSaved() {
  savedSnapshot.value = JSON.stringify(editorPayload.value);
}

function applyTemplate(data) {
  currentName.value = data.name ?? '';
  currentDescription.value = data.description ?? '';
  currentSpecies.value = data.species ?? 'all';
  sections.value = Array.isArray(data.sections) ? data.sections : [];
  if (!sections.value.some((section) => section.key === activeKey.value)) {
    activeKey.value = sections.value[0]?.key ?? '';
  }
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const { data } = await http.get('/settings/form-templates/' + currentId.value, {
      params: { includeDisabled: 1 },
    });
    applyTemplate(data);
    markSaved();
  } catch (err) {
    error.value = err.response?.status === 404
      ? '找不到這份表單'
      : '表單內容暫時無法載入，請稍後重試';
  } finally {
    loading.value = false;
  }
}

function presentationMeta(presentation) {
  return PRESENTATION_OPTIONS.find((option) => option.value === presentation) ?? PRESENTATION_OPTIONS[0];
}

function typeMeta(type) {
  return TYPE_META[type] ?? { title: '一般欄位', icon: Type, hint: '' };
}

function move(list, index, offset) {
  const target = index + offset;
  if (target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
}

function focusSection(key) {
  activeKey.value = key;
  selectedItemKey.value = null;
}

function selectItem(section, key) {
  activeKey.value = section.key;
  selectedItemKey.value = key;
}

function addSection() {
  const draft = {
    key: '__new_section_' + Date.now(),
    title: '新區塊',
    reportTitle: '',
    description: '',
    presentation: 'keyValue',
    enabled: true,
    items: [],
  };
  sections.value.push(draft);
  focusSection(draft.key);
}

function requestSectionDelete(section) {
  sectionToDelete.value = section;
}

function confirmSectionDelete() {
  const section = sectionToDelete.value;
  if (!section) return;
  const index = sections.value.indexOf(section);
  if (index >= 0) sections.value.splice(index, 1);
  sectionToDelete.value = null;
  if (activeKey.value === section.key) {
    focusSection(sections.value[Math.min(index, sections.value.length - 1)]?.key ?? '');
  }
}

// 工具箱點一下就放進目前區塊，並直接跳到設定面板 —— 新增與設定是同一個動作。
function addItem(type) {
  const section = activeSection.value;
  if (!section) return;
  const key = '__new_item_' + Date.now();
  section.items = section.items ?? [];
  section.items.push({
    key,
    label: '新項目',
    type,
    role: null,
    // 檢驗項目沿用同區塊上一個分組，少一個容易漏填又看不出來的欄位。
    group: type === 'lab' ? (sectionGroups.value.at(-1) ?? '') : '',
    unit: '',
    placeholder: '',
    options: OPTION_TYPES.has(type) ? ['正常', '異常'] : [],
    span: 'auto',
    enabled: true,
    required: false,
    numeric: true,
    rows: null,
    min: null,
    max: null,
    step: null,
    referenceMin: null,
    referenceMax: null,
  });
  selectedItemKey.value = key;
  nextTick(() => {
    const input = document.getElementById('item-label');
    input?.focus();
    input?.select?.();
  });
}

// 下拉選單／單選／複選的選項一列一個。這裡一律換掉整個陣列而不是就地改索引，
// isDirty 是比對 JSON 快照，就地改索引在某些情況下不會被視為變更。
function setOption(index, value) {
  const item = selectedItem.value;
  if (!item) return;
  const options = [...(item.options ?? [])];
  options[index] = value;
  item.options = options;
}

function addOption() {
  const item = selectedItem.value;
  if (!item) return;
  item.options = [...(item.options ?? []), ''];
  nextTick(() => document.getElementById('item-option-' + (item.options.length - 1))?.focus());
}

function removeOption(index) {
  const item = selectedItem.value;
  if (!item) return;
  item.options = (item.options ?? []).filter((_, position) => position !== index);
}

// 移除項目不跳確認 —— 變更要按「儲存變更」才會寫回，誤刪就直接離開頁面不要存。
// 區塊刪除仍然要確認：它會一次帶走裡面所有項目。
function removeItem(section, item) {
  if (!item) return;
  const index = (section?.items ?? []).indexOf(item);
  if (index >= 0) section.items.splice(index, 1);
  if (selectedItemKey.value === item.key) selectedItemKey.value = null;
}

function removeItemByKey(section, key) {
  activeKey.value = section.key;
  removeItem(section, (section.items ?? []).find((item) => item.key === key));
}

function focusProblem(section, item) {
  activeView.value = 'design';
  activeKey.value = section.key;
  selectedItemKey.value = item?.key ?? null;
}

function validateBeforeSave() {
  if (!currentName.value.trim()) {
    error.value = '請先輸入健檢類型名稱。';
    return false;
  }
  if (!sections.value.length) {
    error.value = '表單至少需要一個區塊。';
    return false;
  }
  for (const section of sections.value) {
    if (!String(section.title ?? '').trim()) {
      focusProblem(section, null);
      error.value = '每個區塊都需要名稱。';
      return false;
    }
    for (const item of section.items ?? []) {
      if (!String(item.label ?? '').trim()) {
        focusProblem(section, item);
        error.value = '每個項目都需要名稱。';
        return false;
      }
      if (
        item.referenceMin !== null
        && item.referenceMin !== ''
        && item.referenceMax !== null
        && item.referenceMax !== ''
        && Number(item.referenceMin) > Number(item.referenceMax)
      ) {
        focusProblem(section, item);
        error.value = '參考範圍的下限不能大於上限。';
        return false;
      }
    }
  }
  return true;
}

async function save({ confirmRoleRemoval = false } = {}) {
  if (!currentId.value || saving.value) return;
  error.value = '';
  if (!validateBeforeSave()) return;
  saving.value = true;
  try {
    const keepSectionKey = activeKey.value;
    const keepItemKey = selectedItemKey.value;
    const { data } = await http.put('/settings/form-templates/' + currentId.value, {
      ...editorPayload.value,
      confirmRoleRemoval,
    });
    applyTemplate(data);
    // 儲存後伺服器會重新編 key，選取狀態盡量留在原地，留不住就退回第一個區塊。
    activeKey.value = sections.value.some((section) => section.key === keepSectionKey)
      ? keepSectionKey
      : sections.value[0]?.key ?? '';
    selectedItemKey.value = (activeSection.value?.items ?? []).some((item) => item.key === keepItemKey)
      ? keepItemKey
      : null;
    pendingRoleRemoval.value = null;
    clearTemplateCache();
    markSaved();
    toast.success('之後新建的報告會套用這份表單。', '表單已儲存');
  } catch (err) {
    const response = err.response;
    if (response?.status === 409 && response.data?.missingRoles) {
      pendingRoleRemoval.value = response.data;
      return;
    }
    error.value = response?.data?.message ?? '表單儲存失敗，請稍後再試。';
    toast.error(error.value, '儲存失敗');
  } finally {
    saving.value = false;
  }
}

function warnBeforeUnload(event) {
  if (!isDirty.value) return;
  event.preventDefault();
  event.returnValue = '';
}

// 選取的項目被刪掉或跟著區塊換掉時，設定面板不能停在已經不存在的項目上。
watch([activeKey, sections], () => {
  if (selectedItemKey.value && !selectedItem.value) selectedItemKey.value = null;
}, { deep: true });

onMounted(() => {
  load();
  window.addEventListener('beforeunload', warnBeforeUnload);
});
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnBeforeUnload));
// 換頁的攔截改用站內的 ConfirmDialog，跟頁面上其他確認一致。
// 導航守衛可以回傳 Promise，所以把 resolve 收起來等使用者按下按鈕再放行。
// （離開分頁／關視窗仍然是 beforeunload，那個提示由瀏覽器控制，無法換掉。）
const leaveResolve = ref(null);
const showLeaveConfirm = computed(() => Boolean(leaveResolve.value));

onBeforeRouteLeave(() => {
  if (!isDirty.value) return true;
  return new Promise((resolve) => {
    leaveResolve.value = resolve;
  });
});

function resolveLeave(confirmed) {
  const resolve = leaveResolve.value;
  // 取消時 ConfirmDialog 會同時送出 cancel 與 update:open，這裡先清空避免重複 resolve。
  leaveResolve.value = null;
  resolve?.(confirmed);
}
</script>

<template>
  <section class="mx-auto max-w-350 space-y-5 pb-24">
    <!-- 不透明底色，不用 backdrop-blur：捲動時每一幀重算模糊是長表單最主要的掉幀來源。 -->
    <header class="sticky top-16 z-10 lg:top-0 -mx-4 border-b border-cream-300 bg-cream-100 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950 sm:-mx-6 sm:px-6">
      <div class="mx-auto flex max-w-350 flex-wrap items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <router-link to="/settings/forms" class="inline-flex min-h-9 shrink-0 items-center text-sm font-medium text-belle-600 hover:text-belle-700 dark:text-brand-400">
            ← 健檢表單
          </router-link>
          <span class="h-4 w-px shrink-0 bg-cream-300 dark:bg-zinc-700" />
          <h1 class="truncate text-xl font-semibold text-ink-900 dark:text-white">{{ currentName || '健檢表單' }}</h1>
          <Badge v-if="!loading" :variant="isDirty ? 'secondary' : 'outline'" :class="isDirty ? 'shrink-0 text-amber-800 dark:text-amber-200' : 'shrink-0 text-ink-500 dark:text-zinc-400'">
            {{ isDirty ? '尚未儲存' : '已儲存' }}
          </Badge>
        </div>
        <div class="flex items-center gap-2">
          <nav class="inline-flex rounded-xl border border-cream-300 bg-cream-50 p-1 dark:border-zinc-800 dark:bg-zinc-900" aria-label="編輯模式">
            <button
              type="button"
              class="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors"
              :class="activeView === 'design' ? 'bg-white text-belle-700 shadow-sm dark:bg-zinc-800 dark:text-brand-300' : 'text-ink-500 hover:text-ink-900 dark:text-zinc-400 dark:hover:text-white'"
              @click="activeView = 'design'"
            >
              <LayoutList class="h-4 w-4" stroke-width="1.75" />設計
            </button>
            <button
              type="button"
              class="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors"
              :class="activeView === 'preview' ? 'bg-white text-belle-700 shadow-sm dark:bg-zinc-800 dark:text-brand-300' : 'text-ink-500 hover:text-ink-900 dark:text-zinc-400 dark:hover:text-white'"
              @click="activeView = 'preview'"
            >
              <Eye class="h-4 w-4" stroke-width="1.75" />預覽
            </button>
          </nav>
          <Button type="button" class="min-h-11" :disabled="saving || loading || !isDirty" @click="save()">
            <Save class="h-4 w-4" stroke-width="1.75" />
            {{ saving ? '儲存中…' : '儲存變更' }}
          </Button>
        </div>
      </div>
    </header>

    <p v-if="error" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
      {{ error }}
    </p>
    <p v-if="loading" class="py-12 text-center text-sm text-ink-500 dark:text-zinc-400" role="status">
      載入表單中…
    </p>

    <template v-else>
      <div v-if="activeView === 'design'" class="space-y-5">
        <div class="rounded-2xl border border-cream-300 bg-cream-50 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 class="text-base font-semibold text-ink-900 dark:text-white">基本資料</h2>
          <p class="mt-1 text-sm text-ink-500 dark:text-zinc-400">這些資訊會顯示在建立健檢報告時的類型選單。</p>
          <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(220px,1fr)_180px_2fr]">
            <div class="space-y-1.5">
              <Label for="template-name" class="text-xs font-medium">健檢類型名稱</Label>
              <Input id="template-name" v-model="currentName" class="min-h-11" />
            </div>
            <div class="space-y-1.5">
              <Label for="template-species" class="text-xs font-medium">適用物種</Label>
              <Select v-model="currentSpecies">
                <SelectTrigger id="template-species" class="min-h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">不限物種</SelectItem>
                  <SelectItem value="cat">貓</SelectItem>
                  <SelectItem value="dog">犬</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-1.5">
              <Label for="template-description" class="text-xs font-medium">簡短說明</Label>
              <Input id="template-description" v-model="currentDescription" class="min-h-11" placeholder="選填，例如：適合年度例行健康檢查" />
            </div>
          </div>
        </div>

        <div class="grid items-start gap-5 xl:grid-cols-[236px_minmax(0,1fr)_320px]">
          <!-- 左：區塊清單 + 工具箱 -->
          <aside class="space-y-4 xl:sticky xl:top-20">
            <div class="rounded-2xl border border-cream-300 bg-cream-50 p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div class="mb-2 flex items-center justify-between px-1">
                <h2 class="text-base font-semibold text-ink-900 dark:text-white">區塊</h2>
                <Badge variant="outline">{{ sections.length }}</Badge>
              </div>
              <div
                v-for="(section, index) in sections"
                :key="section.key"
                class="flex items-center gap-0.5 rounded-xl border p-1 transition-colors"
                :class="activeKey === section.key
                  ? 'border-belle-300 bg-belle-100 dark:border-brand-500/40 dark:bg-brand-500/15'
                  : 'border-transparent hover:bg-cream-100 dark:hover:bg-zinc-800'"
              >
                <button type="button" class="min-h-10 min-w-0 flex-1 rounded-lg px-2 text-left" @click="focusSection(section.key)">
                  <span class="block truncate text-sm font-medium" :class="section.enabled === false ? 'text-ink-400 dark:text-zinc-500' : 'text-ink-900 dark:text-white'">
                    {{ section.title || '未命名區塊' }}
                  </span>
                  <span class="block text-xs text-ink-400 dark:text-zinc-500">
                    {{ presentationMeta(section.presentation).title }} · {{ (section.items ?? []).length }} 項<span v-if="section.enabled === false"> · 已停用</span>
                  </span>
                </button>
                <button type="button" class="flex h-8 w-6 items-center justify-center rounded text-ink-400 hover:text-ink-900 disabled:opacity-25 dark:text-zinc-500 dark:hover:text-white" :disabled="index === 0" aria-label="上移區塊" @click="move(sections, index, -1)">
                  <ChevronUp class="h-4 w-4" stroke-width="1.75" />
                </button>
                <button type="button" class="flex h-8 w-6 items-center justify-center rounded text-ink-400 hover:text-ink-900 disabled:opacity-25 dark:text-zinc-500 dark:hover:text-white" :disabled="index === sections.length - 1" aria-label="下移區塊" @click="move(sections, index, 1)">
                  <ChevronDown class="h-4 w-4" stroke-width="1.75" />
                </button>
              </div>
              <Button type="button" variant="outline" size="sm" class="mt-2 min-h-10 w-full" @click="addSection">
                <Plus class="h-4 w-4" stroke-width="1.75" />新增區塊
              </Button>
            </div>

            <div class="rounded-2xl border border-cream-300 bg-cream-50 p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <h2 class="px-1 text-base font-semibold text-ink-900 dark:text-white">工具箱</h2>
              <p class="mb-2 px-1 text-xs text-ink-400 dark:text-zinc-500">
                <template v-if="activeSection">點一下加進「{{ activeSection.title || '未命名區塊' }}」</template>
                <template v-else>請先選一個區塊</template>
              </p>
              <div class="space-y-1">
                <template v-for="group in TOOLBOX_GROUPS" :key="group.title">
                  <p class="px-1 pt-2 text-xs text-ink-400 dark:text-zinc-500">{{ group.title }}</p>
                  <button
                    v-for="type in group.types"
                    :key="type"
                    type="button"
                    class="flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                    :class="type === featuredType
                      ? 'border-belle-200 bg-white hover:border-belle-400 dark:border-brand-500/30 dark:bg-zinc-950 dark:hover:border-brand-500'
                      : 'border-transparent hover:bg-cream-100 dark:hover:bg-zinc-800'"
                    :disabled="!activeSection"
                    @click="addItem(type)"
                  >
                    <component :is="typeMeta(type).icon" class="h-4 w-4 shrink-0 text-belle-600 dark:text-brand-400" stroke-width="1.75" />
                    <span class="min-w-0">
                      <span class="block text-sm font-medium text-ink-900 dark:text-white">{{ typeMeta(type).title }}</span>
                      <span class="block truncate text-xs text-ink-400 dark:text-zinc-500">{{ typeMeta(type).hint }}</span>
                    </span>
                  </button>
                </template>
              </div>
            </div>
          </aside>

          <!-- 中：畫布，就是醫師填表單時看到的樣子 -->
          <div v-if="sections.length" class="space-y-4">
            <article
              v-for="(section, index) in sections"
              :key="section.key"
              class="rounded-2xl border p-4 transition-all sm:p-5"
              :class="activeKey === section.key
                ? 'border-belle-500 bg-white shadow-md ring-2 ring-belle-500/20 dark:border-brand-500 dark:bg-zinc-900 dark:shadow-[0_0_24px_-8px_var(--color-brand-500)] dark:ring-brand-500/25'
                : 'cursor-pointer border-cream-300 bg-cream-50 shadow-sm hover:border-belle-300 dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-zinc-700'"
              @click="focusSection(section.key)"
            >
              <div class="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div class="min-w-0">
                  <p v-if="activeKey === section.key" class="inline-flex items-center rounded-full bg-belle-600 px-2 py-0.5 text-xs font-medium text-white dark:bg-brand-500 dark:text-zinc-950">
                    區塊 {{ index + 1 }} · 編輯中
                  </p>
                  <p v-else class="text-xs font-medium text-ink-400 dark:text-zinc-500">區塊 {{ index + 1 }}</p>
                  <h2 class="mt-0.5 truncate text-base font-semibold text-ink-900 dark:text-white">{{ section.title || '未命名區塊' }}</h2>
                  <p v-if="section.description" class="mt-0.5 text-xs text-ink-400 dark:text-zinc-500">{{ section.description }}</p>
                </div>
                <div class="flex shrink-0 items-center gap-1.5">
                  <Badge variant="outline">{{ presentationMeta(section.presentation).title }}</Badge>
                  <Badge v-if="section.enabled === false" variant="secondary">已停用</Badge>
                </div>
              </div>
              <FormSectionPreview
                :section="section"
                selectable
                show-disabled
                :selected-key="activeKey === section.key ? selectedItemKey : null"
                @update:selected-key="(key) => selectItem(section, key)"
                @remove="(key) => removeItemByKey(section, key)"
              />
              <p v-if="!(section.items ?? []).length" class="mt-2 text-center text-xs text-ink-400 dark:text-zinc-500">
                從左邊的工具箱挑一種欄位加進來。
              </p>
            </article>

            <div class="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle class="mt-0.5 h-5 w-5 shrink-0" stroke-width="1.75" />
              <p>這裡的變更只套用到之後新建的報告；既有草稿與已結案報告會保留原本內容。</p>
            </div>
          </div>

          <div v-else class="rounded-2xl border border-dashed border-cream-300 px-5 py-14 text-center dark:border-zinc-700">
            <LayoutList class="mx-auto h-8 w-8 text-ink-400 dark:text-zinc-500" stroke-width="1.5" />
            <p class="mt-3 text-sm font-semibold text-ink-700 dark:text-zinc-200">尚未建立表單區塊</p>
            <p class="mt-1 text-xs text-ink-400 dark:text-zinc-500">先建立一個區塊，再從工具箱加入欄位。</p>
            <Button type="button" class="mt-4 min-h-11" @click="addSection">
              <Plus class="h-4 w-4" stroke-width="1.75" />新增第一個區塊
            </Button>
          </div>

          <!-- 右：設定面板，選什麼就設定什麼 -->
          <aside class="xl:sticky xl:top-20">
            <div class="rounded-2xl border border-cream-300 bg-cream-50 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <!-- 項目設定 -->
              <template v-if="selectedItem">
                <div class="mb-4 flex items-center justify-between gap-2 border-b border-cream-300 pb-3 dark:border-zinc-800">
                  <div class="flex min-w-0 items-center gap-2">
                    <component :is="typeMeta(selectedItem.type).icon" class="h-4 w-4 shrink-0 text-belle-600 dark:text-brand-400" stroke-width="1.75" />
                    <h2 class="truncate text-base font-semibold text-ink-900 dark:text-white">{{ selectedItem.label || '未命名項目' }}</h2>
                  </div>
                  <div class="flex shrink-0 items-center gap-0.5">
                    <button type="button" class="flex h-8 w-7 items-center justify-center rounded text-ink-400 hover:text-ink-900 disabled:opacity-25 dark:text-zinc-500 dark:hover:text-white" :disabled="selectedIndex <= 0" aria-label="上移項目" @click="move(activeSection.items, selectedIndex, -1)">
                      <ChevronUp class="h-4 w-4" stroke-width="1.75" />
                    </button>
                    <button type="button" class="flex h-8 w-7 items-center justify-center rounded text-ink-400 hover:text-ink-900 disabled:opacity-25 dark:text-zinc-500 dark:hover:text-white" :disabled="selectedIndex < 0 || selectedIndex === activeSection.items.length - 1" aria-label="下移項目" @click="move(activeSection.items, selectedIndex, 1)">
                      <ChevronDown class="h-4 w-4" stroke-width="1.75" />
                    </button>
                  </div>
                </div>

                <div class="space-y-4">
                  <div class="space-y-1.5">
                    <Label for="item-label" class="text-xs font-medium">項目名稱</Label>
                    <Input id="item-label" v-model="selectedItem.label" class="min-h-11" />
                  </div>

                  <div class="space-y-1.5">
                    <Label class="text-xs font-medium">欄位種類</Label>
                    <div class="grid grid-cols-2 gap-1.5">
                      <button
                        v-for="type in typesForSelected"
                        :key="type"
                        type="button"
                        class="flex min-h-10 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                        :class="selectedItem.type === type
                          ? 'border-belle-500 bg-belle-50 text-belle-700 dark:border-brand-500 dark:bg-brand-500/10 dark:text-brand-300'
                          : 'border-cream-300 text-ink-600 hover:border-belle-300 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-brand-500/50'"
                        @click="selectedItem.type = type"
                      >
                        <component :is="typeMeta(type).icon" class="h-4 w-4 shrink-0" stroke-width="1.75" />
                        <span class="truncate">{{ typeMeta(type).title }}</span>
                      </button>
                    </div>
                    <p v-if="ROLE_HINTS[selectedItem.role]" class="flex items-start gap-1.5 text-xs text-ink-500 dark:text-zinc-400">
                      <Info class="mt-0.5 h-3.5 w-3.5 shrink-0" stroke-width="1.75" />
                      {{ ROLE_HINTS[selectedItem.role] }}
                    </p>
                  </div>

                  <div class="grid grid-cols-2 gap-2">
                    <div class="flex min-h-12 items-center justify-between gap-2 rounded-xl border border-cream-300 px-3 dark:border-zinc-700">
                      <span class="text-sm font-medium text-ink-700 dark:text-zinc-200">顯示</span>
                      <Switch :model-value="selectedItem.enabled !== false" aria-label="在表單上顯示這個項目" @update:model-value="selectedItem.enabled = $event" />
                    </div>
                    <div class="flex min-h-12 items-center justify-between gap-2 rounded-xl border border-cream-300 px-3 dark:border-zinc-700">
                      <span class="text-sm font-medium text-ink-700 dark:text-zinc-200">必填</span>
                      <Switch :model-value="selectedItem.required === true" aria-label="結案前必須完成" @update:model-value="selectedItem.required = $event" />
                    </div>
                  </div>

                  <div v-if="spanApplies(activeSection, selectedItem)" class="space-y-1.5">
                    <Label class="text-xs font-medium">寬度</Label>
                    <div class="grid grid-cols-3 gap-1.5">
                      <button
                        v-for="option in SPAN_OPTIONS"
                        :key="option.value"
                        type="button"
                        class="flex min-h-10 items-center justify-center rounded-lg border px-2 text-sm font-medium transition-colors"
                        :class="(selectedItem.span ?? 'auto') === option.value
                          ? 'border-belle-500 bg-belle-50 text-belle-700 dark:border-brand-500 dark:bg-brand-500/10 dark:text-brand-300'
                          : 'border-cream-300 text-ink-600 hover:border-belle-300 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-brand-500/50'"
                        :title="option.hint"
                        @click="selectedItem.span = option.value"
                      >{{ option.title }}</button>
                    </div>
                    <p class="text-xs text-ink-400 dark:text-zinc-500">畫布較窄時欄數會自動收合，屆時「加寬」等同整排。</p>
                  </div>

                  <div v-if="['number', 'measurement', 'lab'].includes(selectedItem.type)" class="space-y-1.5">
                    <Label for="item-unit" class="text-xs font-medium">單位</Label>
                    <Input id="item-unit" v-model="selectedItem.unit" class="min-h-11" placeholder="例如：kg、°C、mg/dL" />
                  </div>

                  <template v-if="selectedItem.type === 'lab'">
                    <div class="space-y-1.5">
                      <Label for="item-group" class="text-xs font-medium">檢驗分組</Label>
                      <Input id="item-group" v-model="selectedItem.group" class="min-h-11" list="lab-group-options" placeholder="留空即為未分組" />
                      <datalist id="lab-group-options">
                        <option v-for="group in labGroupOptions" :key="group" :value="group" />
                      </datalist>
                      <p class="text-xs text-ink-400 dark:text-zinc-500">同一組的檢驗項目會在表單與報告上排在一起。</p>
                    </div>
                    <div class="flex min-h-12 items-center justify-between gap-2 rounded-xl border border-cream-300 px-3 dark:border-zinc-700">
                      <span class="min-w-0">
                        <span class="block text-sm font-medium text-ink-700 dark:text-zinc-200">數值型項目</span>
                        <span class="block text-xs text-ink-400 dark:text-zinc-500">可設參考範圍自動判讀</span>
                      </span>
                      <Switch :model-value="selectedItem.numeric !== false" aria-label="數值型項目" @update:model-value="selectedItem.numeric = $event" />
                    </div>
                  </template>

                  <div v-if="['measurement', 'lab'].includes(selectedItem.type) && selectedItem.numeric !== false" class="space-y-1.5">
                    <Label class="text-xs font-medium">參考範圍</Label>
                    <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                      <Input v-model="selectedItem.referenceMin" type="number" class="min-h-11" placeholder="下限" aria-label="參考範圍下限" />
                      <span class="text-sm text-ink-400 dark:text-zinc-500">至</span>
                      <Input v-model="selectedItem.referenceMax" type="number" class="min-h-11" placeholder="上限" aria-label="參考範圍上限" />
                    </div>
                    <p class="text-xs text-ink-400 dark:text-zinc-500">留空即不自動判讀正常或異常。</p>
                  </div>

                  <div v-if="OPTION_TYPES.has(selectedItem.type)" class="space-y-1.5">
                    <Label class="text-xs font-medium">選項</Label>
                    <div v-if="(selectedItem.options ?? []).length" class="space-y-1.5">
                      <div v-for="(option, index) in selectedItem.options" :key="index" class="flex items-center gap-1">
                        <Input
                          :id="'item-option-' + index"
                          :model-value="option"
                          class="min-h-11"
                          :placeholder="'選項 ' + (index + 1)"
                          :aria-label="'選項 ' + (index + 1)"
                          @update:model-value="setOption(index, $event)"
                          @keydown.enter.prevent="addOption()"
                        />
                        <button
                          type="button"
                          class="flex h-11 w-9 shrink-0 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-cream-100 hover:text-red-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-red-300"
                          :aria-label="'刪除選項 ' + (index + 1)"
                          @click="removeOption(index)"
                        >
                          <X class="h-4 w-4" stroke-width="1.75" />
                        </button>
                      </div>
                    </div>
                    <p v-else class="text-xs text-ink-400 dark:text-zinc-500">還沒有選項，這個欄位在表單上會是空的。</p>
                    <Button type="button" variant="outline" size="sm" class="min-h-10 w-full" @click="addOption()">
                      <Plus class="h-4 w-4" stroke-width="1.75" />新增選項
                    </Button>
                    <p class="text-xs text-ink-400 dark:text-zinc-500">按 Enter 可以直接接著加下一個；留空的選項會在儲存時移除。</p>
                  </div>

                  <div v-if="['text', 'textarea', 'number', 'date'].includes(selectedItem.type)" class="space-y-1.5">
                    <Label for="item-placeholder" class="text-xs font-medium">輸入提示</Label>
                    <Input id="item-placeholder" v-model="selectedItem.placeholder" class="min-h-11" placeholder="選填，顯示在空白欄位裡" />
                  </div>

                  <div class="border-t border-cream-300 pt-3 dark:border-zinc-800">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      class="min-h-10 w-full border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
                      @click="removeItem(activeSection, selectedItem)"
                    >
                      <Trash2 class="h-4 w-4" stroke-width="1.75" />刪除項目
                    </Button>
                  </div>
                </div>
              </template>

              <!-- 區塊設定 -->
              <template v-else-if="activeSection">
                <div class="mb-4 flex items-center justify-between gap-2 border-b border-cream-300 pb-3 dark:border-zinc-800">
                  <h2 class="truncate text-base font-semibold text-ink-900 dark:text-white">區塊設定</h2>
                  <Switch :model-value="activeSection.enabled !== false" aria-label="啟用這個區塊" @update:model-value="activeSection.enabled = $event" />
                </div>

                <div class="space-y-4">
                  <div class="space-y-1.5">
                    <Label for="section-title" class="text-xs font-medium">區塊名稱</Label>
                    <Input id="section-title" v-model="activeSection.title" class="min-h-11" />
                  </div>
                  <div class="space-y-1.5">
                    <Label for="section-presentation" class="text-xs font-medium">呈現方式</Label>
                    <Select v-model="activeSection.presentation">
                      <SelectTrigger id="section-presentation" class="min-h-11 w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem v-for="option in PRESENTATION_OPTIONS" :key="option.value" :value="option.value">{{ option.title }}</SelectItem>
                      </SelectContent>
                    </Select>
                    <p class="text-xs leading-relaxed text-ink-400 dark:text-zinc-500">
                      {{ presentationMeta(activeSection.presentation).hint }}它決定工具箱提供哪些欄位；既有項目會保留原本的種類。
                    </p>
                  </div>
                  <div class="space-y-1.5">
                    <Label for="section-description" class="text-xs font-medium">提示說明</Label>
                    <Input id="section-description" v-model="activeSection.description" class="min-h-11" placeholder="選填，顯示在區塊標題下方" />
                  </div>
                  <div class="space-y-1.5">
                    <Label for="section-report-title" class="text-xs font-medium">PDF 報告標題</Label>
                    <Input id="section-report-title" v-model="activeSection.reportTitle" class="min-h-11" placeholder="留空即沿用區塊名稱" />
                  </div>

                  <div class="border-t border-cream-300 pt-3 dark:border-zinc-800">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      class="min-h-10 w-full border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
                      @click="requestSectionDelete(activeSection)"
                    >
                      <Trash2 class="h-4 w-4" stroke-width="1.75" />刪除這個區塊
                    </Button>
                  </div>
                </div>
              </template>

              <div v-else class="py-10 text-center">
                <MousePointerClick class="mx-auto h-7 w-7 text-ink-400 dark:text-zinc-500" stroke-width="1.5" />
                <p class="mt-3 text-sm font-medium text-ink-700 dark:text-zinc-200">選一個區塊開始編輯</p>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <div v-else class="space-y-5">
        <div class="rounded-2xl border border-cream-300 bg-cream-50 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 class="text-base font-semibold text-ink-900 dark:text-white">醫師填寫畫面預覽</h2>
              <p class="mt-1 text-sm text-ink-500 dark:text-zinc-400">僅供預覽，這裡輸入的內容不會被儲存。</p>
            </div>
            <Badge variant="outline">{{ visibleSections.length }} 個啟用區塊</Badge>
          </div>
        </div>

        <div v-if="visibleSections.length" class="space-y-5">
          <div v-for="(section, index) in visibleSections" :key="section.key" class="rounded-2xl border border-cream-300 bg-cream-50 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div class="mb-4 flex items-start gap-3">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-belle-50 text-sm font-semibold text-belle-700 dark:bg-brand-500/10 dark:text-brand-300">{{ index + 1 }}</span>
              <div>
                <h3 class="text-sm font-semibold text-ink-900 dark:text-white">{{ section.title || '未命名區塊' }}</h3>
                <p v-if="section.description" class="mt-0.5 text-xs text-ink-500 dark:text-zinc-400">{{ section.description }}</p>
              </div>
            </div>
            <FormSectionPreview :section="section" />
          </div>
        </div>
        <p v-else class="rounded-2xl border border-dashed border-cream-300 px-5 py-14 text-center text-sm text-ink-400 dark:border-zinc-700 dark:text-zinc-500">
          目前沒有可預覽的啟用區塊。
        </p>
      </div>
    </template>

    <ConfirmDialog
      :open="Boolean(sectionToDelete)"
      title="刪除這個區塊？"
      :description="'「' + (sectionToDelete?.title || '未命名區塊') + '」與其中 ' + (sectionToDelete?.items?.length ?? 0) + ' 個項目會在儲存後移除。'"
      confirm-label="刪除區塊"
      @update:open="(open) => !open && (sectionToDelete = null)"
      @confirm="confirmSectionDelete"
    />
    <ConfirmDialog
      :open="Boolean(pendingRoleRemoval)"
      title="確認停用系統連動欄位"
      :description="pendingRoleRemoval?.message ?? ''"
      confirm-label="仍要儲存"
      :loading="saving"
      @update:open="(open) => !open && (pendingRoleRemoval = null)"
      @confirm="save({ confirmRoleRemoval: true })"
    />
    <ConfirmDialog
      :open="showLeaveConfirm"
      title="尚有未儲存的變更"
      description="離開這一頁會捨棄剛才的編輯內容，這個動作無法復原。"
      confirm-label="捨棄變更並離開"
      cancel-label="留在此頁"
      @update:open="(open) => !open && resolveLeave(false)"
      @confirm="resolveLeave(true)"
    />
  </section>
</template>
