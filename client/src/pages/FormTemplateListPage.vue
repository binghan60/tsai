<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { LayoutList, Plus, SearchX } from '@lucide/vue';
import { http } from '../api/http';
import { useFormTemplate } from '../composables/useFormTemplate';
import { useToast } from '../composables/useToast';
import { getAvailabilityStatusMeta } from '../lib/recordStatus';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { DialogDescription, DialogFooter, DialogTitle } from '../components/ui/dialog';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import ModalDialog from '../components/ModalDialog.vue';
import SettingsLayout from '../components/SettingsLayout.vue';
import DataCard from '../components/DataCard.vue';
import SegmentedControl from '../components/SegmentedControl.vue';
import FilterBar from '../components/FilterBar.vue';
import ListFooter from '../components/ListFooter.vue';
import RowActions from '../components/RowActions.vue';
import EmptyState from '../components/EmptyState.vue';
import { Alert, AlertDescription } from '../components/ui/alert';
import ListSkeleton from '../components/ListSkeleton.vue';

const router = useRouter();
const toast = useToast();
const { clearTemplateCache } = useFormTemplate();

const templates = ref([]);
const loading = ref(true);
const error = ref('');
const busyId = ref('');
const templateToDelete = ref(null);

const showCreate = ref(false);
const newName = ref('');
const newSpecies = ref('all');
const startMode = ref('standard');
const copyFromId = ref('');
const creating = ref(false);
const createError = ref('');

const queryInput = ref('');
const query = ref('');
const statusFilter = ref('any');

const SPECIES_LABELS = { cat: '貓', dog: '犬', all: '不限物種' };

// 用詞跟表單自己的「適用物種」對齊，整頁只有一套講法。
const STATUS_FILTERS = [
  { value: 'any', label: '全部狀態' },
  { value: 'enabled', label: '使用中' },
  { value: 'disabled', label: '已停用' },
];
const START_MODES = [
  { value: 'standard', title: '使用標準表單', hint: '包含基本資料、量測、理學檢查、檢驗與結論。' },
  { value: 'blank', title: '空白表單', hint: '不含任何區塊，完全依自己的需求從頭建立。' },
  { value: 'copy', title: '複製現有表單', hint: '適合只需要修改少數項目的情況。' },
];
// 「至少保留一份表單」看的是總數，不是篩選後的結果 ——
// 篩掉剩一筆並不代表刪掉它之後就沒表單了。
const canDelete = computed(() => templates.value.length > 1);
const hasFilters = computed(() => Boolean(query.value.trim() || statusFilter.value !== 'any'));
const visibleTemplates = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  return templates.value.filter((template) => {
    if (statusFilter.value !== 'any' && (statusFilter.value === 'enabled') !== Boolean(template.enabled)) return false;
    if (!keyword) return true;
    return `${template.name} ${template.description ?? ''}`.toLowerCase().includes(keyword);
  });
});

// 這頁清單是前端過濾（見上面 visibleTemplates），分頁也跟著在前端切，不另外打 API。
const PAGE_SIZE = 10;
// 列上只留「編輯」，其餘收進 ⋯：以此建立、刪除（至少要留一份表單）。
const templateActions = computed(() => [
  { key: 'duplicate', label: '以此建立新表單', disabled: Boolean(busyId.value) },
  { key: 'delete', label: '刪除表單', danger: true, disabled: Boolean(busyId.value) || !canDelete.value },
]);
function templateAction(key, template) {
  if (key === 'duplicate') openDuplicate(template);
  else if (key === 'delete') templateToDelete.value = template;
}
const page = ref(1);
const totalPages = computed(() => Math.max(Math.ceil(visibleTemplates.value.length / PAGE_SIZE), 1));
const pagedTemplates = computed(() => visibleTemplates.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

// 關鍵字選好、按下搜尋才查——全站搜尋一律走提交式，不做即時。
function applyFilters() {
  query.value = queryInput.value;
  page.value = 1;
}

function clearFilters() {
  queryInput.value = '';
  query.value = '';
  statusFilter.value = 'any';
  page.value = 1;
}

// 狀態切換鈕組是即時篩選，不經過 applyFilters，換條件時單獨重置頁碼。
watch(statusFilter, () => {
  page.value = 1;
});
const selectedSource = computed(() => templates.value.find((template) => template._id === copyFromId.value) ?? null);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const { data } = await http.get('/settings/form-templates', { params: { includeDisabled: 1 } });
    templates.value = data;
  } catch {
    error.value = '表單列表暫時無法載入，請稍後重試';
  } finally {
    loading.value = false;
  }
}

function resetCreate() {
  newName.value = '';
  newSpecies.value = 'all';
  startMode.value = 'standard';
  copyFromId.value = '';
  createError.value = '';
}

function openCreate() {
  resetCreate();
  showCreate.value = true;
}

function openDuplicate(template) {
  resetCreate();
  startMode.value = 'copy';
  copyFromId.value = template._id;
  newName.value = `${template.name} 複本`;
  newSpecies.value = template.species ?? 'all';
  showCreate.value = true;
}

function closeCreate() {
  if (creating.value) return;
  showCreate.value = false;
}

async function createTemplate() {
  const name = newName.value.trim();
  if (!name) {
    createError.value = '請填寫表單名稱';
    return;
  }
  if (startMode.value === 'copy' && !copyFromId.value) {
    createError.value = '請選擇要複製的表單';
    return;
  }

  creating.value = true;
  createError.value = '';
  try {
    const payload = {
      name,
      species: newSpecies.value,
      start: startMode.value,
      ...(startMode.value === 'copy' ? { copyFrom: copyFromId.value } : {}),
    };
    const { data } = await http.post('/settings/form-templates', payload);
    clearTemplateCache();
    showCreate.value = false;
    toast.success(
      startMode.value === 'blank' ? `已建立「${name}」，接著加入第一個區塊` : `已建立「${name}」，接著調整表單內容`,
      '新增成功'
    );
    await router.push(`/settings/forms/${data._id}`);
  } catch (err) {
    createError.value = err.response?.data?.message ?? '新增表單失敗';
  } finally {
    creating.value = false;
  }
}

async function toggleEnabled(template, enabled) {
  busyId.value = template._id;
  try {
    const { data } = await http.put(`/settings/form-templates/${template._id}`, {
      enabled,
      expectedVersion: template.documentVersion ?? 0,
    });
    clearTemplateCache();
    template.enabled = enabled;
    template.documentVersion = data.documentVersion;
    toast.success(enabled ? `「${template.name}」已可供建立報告` : `「${template.name}」已停用`, '狀態已更新');
  } catch (err) {
    toast.error(err.response?.data?.message ?? '更新失敗', '更新失敗');
    await load();
  } finally {
    busyId.value = '';
  }
}

async function remove() {
  const target = templateToDelete.value;
  if (!target) return;
  busyId.value = target._id;
  try {
    await http.delete(`/settings/form-templates/${target._id}`);
    templateToDelete.value = null;
    clearTemplateCache();
    await load();
    toast.success(`已刪除「${target.name}」`, '刪除成功');
  } catch (err) {
    templateToDelete.value = null;
    toast.error(err.response?.data?.message ?? '刪除表單失敗', '刪除失敗');
  } finally {
    busyId.value = '';
  }
}

onMounted(load);
</script>

<template>
  <SettingsLayout title="表單管理" description="醫師建立健檢報告時選用的表單；停用後不影響已建立的草稿與報告。">
    <template #actions>
      <Button type="button" @click="openCreate"><Plus stroke-width="1.75" />新增健檢表單</Button>
    </template>
    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <ListSkeleton v-if="loading" :rows="4" :avatar="false" />

    <DataCard v-else-if="templates.length" title="健檢表單" :count="visibleTemplates.length" style="--data-columns: minmax(16rem, 2fr) 11rem 9rem 11rem">
      <template #filters>
        <SegmentedControl v-model="statusFilter" aria-label="依使用狀態篩選" :options="STATUS_FILTERS" />
        <FilterBar id="template-search" v-model="queryInput" label="搜尋健檢表單" placeholder="表單名稱或說明" class="w-full min-w-0 md:w-80" @submit="applyFilters" />
      </template>
      <EmptyState v-if="!visibleTemplates.length" :icon="SearchX" title="找不到符合條件的表單" description="換個關鍵字，或清除目前的篩選條件。" inset>
        <Button type="button" variant="secondary" class="mt-4" @click="clearFilters">清除篩選</Button>
      </EmptyState>
      <template v-else>
        <div class="hidden xl:block">
          <div class="desktop-data-header"><span>表單</span><span>內容</span><span>啟用</span><span></span></div>
          <div v-for="template in pagedTemplates" :key="template._id" class="desktop-data-row hover:bg-hover">
            <router-link :to="`/settings/forms/${template._id}`" class="desktop-data-cell flex items-center gap-3">
              <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"><LayoutList class="size-5" stroke-width="1.75" /></span>
              <span class="min-w-0">
                <span class="block truncate font-semibold text-primary">{{ template.name }}</span>
                <span v-if="template.description" class="block truncate text-xs text-subtle-foreground">{{ template.description }}</span>
              </span>
            </router-link>
            <span class="desktop-data-cell text-sm text-muted-foreground"><span class="num">{{ template.sectionCount }}</span> 區塊　<span class="num">{{ template.itemCount }}</span> 項目</span>
            <span class="desktop-data-cell flex items-center gap-2">
              <Switch :id="`enabled-${template._id}`" :model-value="template.enabled" :disabled="busyId === template._id" @update:model-value="toggleEnabled(template, $event)" />
              <Label :for="`enabled-${template._id}`" :class="getAvailabilityStatusMeta(template.enabled).textClass">{{ getAvailabilityStatusMeta(template.enabled).label }}</Label>
            </span>
            <span class="desktop-data-cell flex items-center justify-end gap-1">
              <Button as-child variant="soft" size="sm"><router-link :to="`/settings/forms/${template._id}`">編輯</router-link></Button>
              <RowActions :actions="templateActions" :label="`${template.name}的更多操作`" @select="(key) => templateAction(key, template)" />
            </span>
          </div>
        </div>

        <ul class="divide-y divide-border xl:hidden">
          <li v-for="template in pagedTemplates" :key="template._id" class="space-y-2 px-4 py-3">
            <div class="flex items-start gap-3">
              <router-link :to="`/settings/forms/${template._id}`" class="min-w-0 flex-1">
                <span class="block truncate font-semibold text-primary">{{ template.name }}</span>
                <span class="text-sm text-muted-foreground"><span class="num">{{ template.sectionCount }}</span> 區塊　<span class="num">{{ template.itemCount }}</span> 項目</span>
              </router-link>
              <Switch :id="`enabled-sm-${template._id}`" :model-value="template.enabled" :disabled="busyId === template._id" :aria-label="template.enabled ? '停用表單' : '啟用表單'" @update:model-value="toggleEnabled(template, $event)" />
              <RowActions :actions="templateActions" :label="`${template.name}的更多操作`" @select="(key) => templateAction(key, template)" />
            </div>
          </li>
        </ul>

      </template>
      <template v-if="visibleTemplates.length" #footer>
        <ListFooter :page="page" :total-pages="totalPages" :total="visibleTemplates.length" :page-size="PAGE_SIZE" @update:page="page = $event" />
      </template>
    </DataCard>

    <EmptyState
      v-else-if="!loading"
      :icon="LayoutList"
      title="還沒有健檢表單"
      description="先從標準結構建立第一份表單。"
    >
      <Button type="button" class="mt-4" @click="openCreate"><Plus class="h-4 w-4" />新增健檢表單</Button>
    </EmptyState>

    <ModalDialog v-if="showCreate" size="lg" @close="closeCreate">
      <div class="p-6 pb-3 sm:p-7 sm:pb-3">
        <DialogTitle>新增健檢表單</DialogTitle>
        <DialogDescription class="mt-1">先決定基本資料與起始內容，建立後再調整個別項目。</DialogDescription>
      </div>

      <form class="flex flex-col" @submit.prevent="createTemplate">
        <div class="space-y-6 p-6 pt-2 sm:p-7 sm:pt-2">
          <section class="space-y-3">
            <div>
              <h3 class="text-sm font-semibold text-foreground">1. 基本資料</h3>
              <p class="mt-0.5 text-xs text-muted-foreground">這個名稱會出現在醫師新增健檢時的選單。</p>
            </div>
            <div class="grid gap-4 sm:grid-cols-[1fr_180px]">
              <div class="space-y-1.5">
                <Label for="new-template-name">表單名稱</Label>
                <Input id="new-template-name" v-model="newName" placeholder="例如：熟齡犬年度健檢" autofocus />
              </div>
              <div class="space-y-1.5">
                <Label for="new-template-species">適用物種</Label>
                <Select v-model="newSpecies">
                  <SelectTrigger id="new-template-species" class="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">不限物種</SelectItem>
                    <SelectItem value="cat">貓</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <section class="space-y-3">
            <div>
              <h3 class="text-sm font-semibold text-foreground">2. 起始內容</h3>
              <p class="mt-0.5 text-xs text-muted-foreground">可以從標準結構開始、留空自己建，或沿用一份現有表單。</p>
            </div>
            <div class="grid gap-3 sm:grid-cols-3">
              <button
                v-for="mode in START_MODES"
                :key="mode.value"
                type="button"
                class="rounded-xl border p-4 text-left transition-colors"
                :class="startMode === mode.value ? 'border-primary bg-accent ring-2 ring-primary/15' : 'border-border bg-field hover:border-primary/35 '"
                :aria-pressed="startMode === mode.value"
                @click="startMode = mode.value"
              >
                <span class="block text-sm font-semibold text-foreground">{{ mode.title }}</span>
                <span class="mt-1 block text-xs leading-relaxed text-muted-foreground">{{ mode.hint }}</span>
              </button>
            </div>
            <div v-if="startMode === 'copy'" class="space-y-1.5">
              <Label for="copy-source">選擇來源表單</Label>
              <Select v-model="copyFromId">
                <SelectTrigger id="copy-source" class="w-full"><SelectValue placeholder="請選擇一份表單" /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="template in templates" :key="template._id" :value="template._id">{{ template.name }}</SelectItem>
                </SelectContent>
              </Select>
              <p v-if="selectedSource" class="text-xs text-muted-foreground">將複製 {{ selectedSource.sectionCount }} 個區塊、{{ selectedSource.itemCount }} 個項目；原表單不會被修改。</p>
            </div>
          </section>

          <Alert v-if="createError" variant="destructive"><AlertDescription>{{ createError }}</AlertDescription></Alert>
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" :disabled="creating" @click="closeCreate">取消</Button>
          <Button type="submit" :disabled="creating || !newName.trim() || (startMode === 'copy' && !copyFromId)">
            {{ creating ? '建立中…' : '建立並編輯' }}
          </Button>
        </DialogFooter>
      </form>
    </ModalDialog>

    <ConfirmDialog
      :open="Boolean(templateToDelete)"
      title="刪除健檢表單"
      :description="`確定刪除「${templateToDelete?.name ?? ''}」嗎？已完成的報告不受影響，但之後無法再用這份表單建立健檢。`"
      confirm-label="刪除表單"
      destructive
      :loading="Boolean(busyId)"
      @update:open="(value) => !value && (templateToDelete = null)"
      @confirm="remove"
    />
  </SettingsLayout>
</template>
