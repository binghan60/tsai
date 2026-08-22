<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Copy, LayoutList, Pencil, Plus, SearchX, Trash2 } from '@lucide/vue';
import { http } from '../api/http';
import { useFormTemplate } from '../composables/useFormTemplate';
import { useToast } from '../composables/useToast';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Switch } from '../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { DialogDescription, DialogFooter, DialogTitle } from '../components/ui/dialog';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import ModalDialog from '../components/ModalDialog.vue';
import SearchPanel from '../components/SearchPanel.vue';
import SettingsLayout from '../components/SettingsLayout.vue';
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

const query = ref('');
const speciesFilter = ref('');
const statusFilter = ref('');

const SPECIES_LABELS = { cat: '貓', dog: '犬', all: '不限物種' };

// 用詞跟表單自己的「適用物種」對齊，整頁只有一套講法。
// 「不限物種」是不篩選，選「貓」時連不限物種的表單一起列出 ——
// 跟後端 listTemplates 的 $in: [species, 'all'] 同一套語意，看到的就是這隻能用的表單。
const SPECIES_FILTERS = [
  { value: '', label: '不限物種' },
  { value: 'cat', label: '貓' },
  { value: 'dog', label: '犬' },
];
const STATUS_FILTERS = [
  { value: '', label: '全部' },
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
const hasFilters = computed(() => Boolean(query.value.trim() || speciesFilter.value || statusFilter.value));
const visibleTemplates = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  return templates.value.filter((template) => {
    const species = template.species ?? 'all';
    if (speciesFilter.value && species !== 'all' && species !== speciesFilter.value) return false;
    if (statusFilter.value && (statusFilter.value === 'enabled') !== Boolean(template.enabled)) return false;
    if (!keyword) return true;
    return `${template.name} ${template.description ?? ''}`.toLowerCase().includes(keyword);
  });
});

function clearFilters() {
  query.value = '';
  speciesFilter.value = '';
  statusFilter.value = '';
}
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
  <SettingsLayout title="表單管理" description="醫師建立健檢時可選用的表單。每份表單都能設定適用物種與檢查內容。">
    <template #actions>
      <Button type="button" @click="openCreate"><Plus class="h-4 w-4" stroke-width="1.75" />新增健檢表單</Button>
    </template>

    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <ListSkeleton v-if="loading" :rows="4" />

    <template v-else-if="templates.length">
      <SearchPanel id="template-search" v-model="query" label="搜尋健檢表單" placeholder="輸入表單名稱或說明">
        <div class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3 px-1">
          <div class="flex flex-wrap items-center gap-2">
            <span id="filter-species-label" class="text-xs font-medium text-muted-foreground">適用物種</span>
            <div class="flex flex-wrap gap-1" role="group" aria-labelledby="filter-species-label">
              <button
                v-for="option in SPECIES_FILTERS"
                :key="option.value"
                type="button"
                class="inline-flex min-h-9 items-center rounded-lg border px-3 text-sm font-medium transition-colors"
                :class="speciesFilter === option.value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-foreground hover:bg-muted/40   '"
                :aria-pressed="speciesFilter === option.value"
                @click="speciesFilter = option.value"
              >{{ option.label }}</button>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <span id="filter-status-label" class="text-xs font-medium text-muted-foreground">狀態</span>
            <div class="flex flex-wrap gap-1" role="group" aria-labelledby="filter-status-label">
              <button
                v-for="option in STATUS_FILTERS"
                :key="option.value"
                type="button"
                class="inline-flex min-h-9 items-center rounded-lg border px-3 text-sm font-medium transition-colors"
                :class="statusFilter === option.value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-foreground hover:bg-muted/40   '"
                :aria-pressed="statusFilter === option.value"
                @click="statusFilter = option.value"
              >{{ option.label }}</button>
            </div>
          </div>

          <Button v-if="hasFilters" type="button" variant="ghost" size="sm" class="ml-auto min-h-9" @click="clearFilters">清除篩選</Button>
        </div>
      </SearchPanel>

      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm text-muted-foreground">
          <template v-if="hasFilters">符合條件 {{ visibleTemplates.length }} 份，共 {{ templates.length }} 份表單</template>
          <template v-else>目前共有 {{ templates.length }} 份表單</template>
        </p>
        <p class="text-xs text-muted-foreground">停用後不影響已建立的草稿與報告</p>
      </div>

      <EmptyState
        v-if="!visibleTemplates.length"
        :icon="SearchX"
        title="找不到符合條件的表單"
        description="換個關鍵字，或清除目前的篩選條件。"
      >
        <Button type="button" variant="outline" class="mt-4" @click="clearFilters">清除篩選</Button>
      </EmptyState>

      <!-- 桌機：一列一份表單，與飼主／寵物列表同一套表格版式 -->
      <Card v-if="visibleTemplates.length" class="hidden gap-0 overflow-hidden py-0 shadow-sm xl:block">
        <Table>
          <TableHeader>
            <TableRow class="border-border text-muted-foreground">
              <TableHead class="font-medium">表單名稱</TableHead>
              <TableHead class="font-medium">適用物種</TableHead>
              <TableHead class="font-medium">內容</TableHead>
              <TableHead class="font-medium">啟用</TableHead>
              <TableHead class="text-right font-medium">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="template in visibleTemplates" :key="template._id" class="border-border">
              <TableCell >
                <router-link :to="`/settings/forms/${template._id}`" class="group flex flex-col justify-center">
                  <span class="font-medium text-belle-600 group-hover:text-belle-700 dark:text-brand-400">{{ template.name }}</span>
                  <span class="text-xs" :class="template.description ? 'text-muted-foreground ' : 'text-muted-foreground '">
                    {{ template.description || '尚未填寫表單說明' }}
                  </span>
                </router-link>
              </TableCell>
              <TableCell class="text-foreground">{{ SPECIES_LABELS[template.species] ?? '不限物種' }}</TableCell>
              <TableCell class="text-foreground">{{ template.sectionCount }} 個區塊・{{ template.itemCount }} 個項目</TableCell>
              <TableCell >
                <div class="flex items-center gap-2">
                  <Switch
                    :id="`enabled-${template._id}`"
                    :model-value="template.enabled"
                    :disabled="busyId === template._id"
                    @update:model-value="toggleEnabled(template, $event)"
                  />
                  <Label :for="`enabled-${template._id}`" class="text-xs" :class="template.enabled ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground '">
                    {{ template.enabled ? '使用中' : '已停用' }}
                  </Label>
                </div>
              </TableCell>
              <TableCell >
                <div class="flex justify-end gap-1">
                  <Button type="button" variant="ghost" size="icon" class="h-11 w-11" :aria-label="`編輯表單 ${template.name}`" @click="router.push(`/settings/forms/${template._id}`)">
                    <Pencil class="h-4 w-4" stroke-width="1.75" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" class="h-11 w-11" :disabled="Boolean(busyId)" :aria-label="`以「${template.name}」建立新表單`" @click="openDuplicate(template)">
                    <Copy class="h-4 w-4" stroke-width="1.75" />
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    class="h-11 w-11"
                    :disabled="Boolean(busyId) || !canDelete"
                    :title="canDelete ? '刪除這份表單' : '至少要保留一份表單'"
                    :aria-label="`刪除表單 ${template.name}`"
                    @click="templateToDelete = template"
                  >
                    <Trash2 class="h-4 w-4" stroke-width="1.75" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      <!-- 手機：表格擠不下，改回一份一張卡 -->
      <div v-if="visibleTemplates.length" class="space-y-3 xl:hidden">
        <Card v-for="template in visibleTemplates" :key="template._id" class="gap-3 p-4 shadow-sm">
          <div class="flex items-start justify-between gap-3">
            <router-link :to="`/settings/forms/${template._id}`" class="min-w-0">
              <span class="block font-semibold text-foreground">{{ template.name }}</span>
              <span class="mt-0.5 block text-xs" :class="template.description ? 'text-muted-foreground ' : 'text-muted-foreground '">
                {{ template.description || '尚未填寫表單說明' }}
              </span>
            </router-link>
            <div class="flex shrink-0 items-center gap-2">
              <Switch
                :id="`enabled-sm-${template._id}`"
                :model-value="template.enabled"
                :disabled="busyId === template._id"
                @update:model-value="toggleEnabled(template, $event)"
              />
              <Label :for="`enabled-sm-${template._id}`" class="sr-only">{{ template.enabled ? '停用表單' : '啟用表單' }}</Label>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <Badge variant="outline" class="rounded-full">{{ SPECIES_LABELS[template.species] ?? '不限物種' }}</Badge>
            <Badge :class="template.enabled ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-muted text-muted-foreground '" class="rounded-full">
              {{ template.enabled ? '使用中' : '已停用' }}
            </Badge>
            <span class="text-xs text-muted-foreground">{{ template.sectionCount }} 個區塊・{{ template.itemCount }} 個項目</span>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" class="min-h-10" @click="router.push(`/settings/forms/${template._id}`)">
              <Pencil class="h-4 w-4" stroke-width="1.75" />編輯表單
            </Button>
            <Button type="button" variant="outline" size="sm" class="min-h-10" :disabled="Boolean(busyId)" @click="openDuplicate(template)">
              <Copy class="h-4 w-4" stroke-width="1.75" />以此建立
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="ml-auto min-h-10 text-red-700 dark:text-red-300"
              :disabled="Boolean(busyId) || !canDelete"
              :title="canDelete ? '刪除這份表單' : '至少要保留一份表單'"
              @click="templateToDelete = template"
            >
              <Trash2 class="h-4 w-4" stroke-width="1.75" />刪除
            </Button>
          </div>
        </Card>
      </div>
    </template>

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
                    <SelectItem value="dog">犬</SelectItem>
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
                :class="startMode === mode.value ? 'border-primary bg-belle-50 ring-2 ring-primary/15 dark:bg-brand-500/10' : 'border-border bg-field hover:border-belle-300 '"
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
          <Button type="button" variant="outline" :disabled="creating" @click="closeCreate">取消</Button>
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
      :loading="Boolean(busyId)"
      @update:open="(value) => !value && (templateToDelete = null)"
      @confirm="remove"
    />
  </SettingsLayout>
</template>
