<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { Copy, FileText, Pencil, Plus, Search, SearchX, Trash2 } from '@lucide/vue';
import { useRoute, useRouter } from 'vue-router';
import { http } from '../api/http';
import { useTextTemplates } from '../composables/useTextTemplates';
import { useToast } from '../composables/useToast';
import SettingsLayout from '../components/SettingsLayout.vue';
import SearchPanel from '../components/SearchPanel.vue';
import EmptyState from '../components/EmptyState.vue';
import ListSkeleton from '../components/ListSkeleton.vue';
import ModalDialog from '../components/ModalDialog.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { DialogDescription, DialogFooter, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Textarea } from '../components/ui/textarea';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const { templates, loadTemplates, createTemplate, updateTemplate, deleteTemplate } = useTextTemplates();

const fields = ref([]);
const loading = ref(true);
const error = ref('');
const query = ref('');
const status = ref('all');
const editorOpen = ref(false);
const editingId = ref('');
const saving = ref(false);
const editorError = ref('');
const deleteTarget = ref(null);
const deleting = ref(false);
const fieldQuery = ref('');
const fieldFormFilter = ref('all');

const form = reactive({
  name: '',
  content: '',
  availableForAllFields: false,
  applicableItemKeys: [],
  enabled: true,
  expectedVersion: 0,
});

const fieldMap = computed(() => new Map(fields.value.map((field) => [field.key, field])));
const fieldFormOptions = computed(() => [...new Set(fields.value.flatMap((field) => field.forms ?? []))]
  .sort((a, b) => a.localeCompare(b, 'zh-Hant')));
const filteredFields = computed(() => {
  const keyword = fieldQuery.value.trim().toLowerCase();
  return fields.value.filter((field) => {
    if (fieldFormFilter.value !== 'all' && !field.forms?.includes(fieldFormFilter.value)) return false;
    return !keyword || `${field.label} ${field.key}`.toLowerCase().includes(keyword);
  });
});
const visibleTemplates = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  return templates.value.filter((template) => {
    if (status.value === 'enabled' && template.enabled === false) return false;
    if (status.value === 'disabled' && template.enabled !== false) return false;
    return !keyword || `${template.name} ${template.content}`.toLowerCase().includes(keyword);
  });
});

function resetForm(template = null) {
  form.name = template?.name ?? '';
  form.content = template?.content ?? '';
  form.availableForAllFields = template?.availableForAllFields === true;
  form.applicableItemKeys = [...(template?.applicableItemKeys ?? [])];
  form.enabled = template?.enabled !== false;
  form.expectedVersion = template?.__v ?? 0;
  fieldQuery.value = '';
  fieldFormFilter.value = 'all';
  editorError.value = '';
}

function openCreate() {
  editingId.value = '';
  resetForm();
  editorOpen.value = true;
}

function openEdit(template) {
  editingId.value = template._id;
  resetForm(template);
  editorOpen.value = true;
}

function duplicate(template) {
  editingId.value = '';
  resetForm({ ...template, name: `${template.name} 複本`, __v: 0 });
  editorOpen.value = true;
}

function toggleField(key, checked) {
  form.applicableItemKeys = checked
    ? [...new Set([...form.applicableItemKeys, key])]
    : form.applicableItemKeys.filter((entry) => entry !== key);
}

function applicabilityLabel(template) {
  if (template.availableForAllFields) return '所有文字欄位';
  const labels = (template.applicableItemKeys ?? []).map((key) => fieldMap.value.get(key)?.label || '已移除欄位');
  if (!labels.length) return '尚未指定欄位';
  return labels.length > 2 ? `${labels.slice(0, 2).join('、')}等 ${labels.length} 個欄位` : labels.join('、');
}

async function save() {
  if (saving.value) return;
  saving.value = true;
  editorError.value = '';
  const payload = {
    name: form.name,
    content: form.content,
    availableForAllFields: form.availableForAllFields,
    applicableItemKeys: form.applicableItemKeys,
    enabled: form.enabled,
    expectedVersion: form.expectedVersion,
  };
  try {
    if (editingId.value) await updateTemplate(editingId.value, payload);
    else await createTemplate(payload);
    toast.success(editingId.value ? '文字模板已更新' : '文字模板已建立');
    editorOpen.value = false;
  } catch (err) {
    editorError.value = err.response?.data?.message ?? '文字模板儲存失敗';
    if (err.response?.status === 409) await loadTemplates({ force: true, includeDisabled: true });
  } finally {
    saving.value = false;
  }
}

async function toggleEnabled(template, enabled) {
  try {
    await updateTemplate(template._id, {
      name: template.name,
      content: template.content,
      availableForAllFields: template.availableForAllFields,
      applicableItemKeys: template.applicableItemKeys,
      enabled,
      expectedVersion: template.__v,
    });
  } catch (err) {
    toast.error(err.response?.data?.message ?? '更新模板狀態失敗');
    await loadTemplates({ force: true, includeDisabled: true });
  }
}

async function confirmDelete() {
  if (!deleteTarget.value || deleting.value) return;
  deleting.value = true;
  try {
    await deleteTemplate(deleteTarget.value._id);
    toast.success(`已刪除「${deleteTarget.value.name}」`);
    deleteTarget.value = null;
  } catch (err) {
    toast.error(err.response?.data?.message ?? '刪除文字模板失敗');
  } finally {
    deleting.value = false;
  }
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [, fieldsResponse] = await Promise.all([
      loadTemplates({ force: true, includeDisabled: true }),
      http.get('/text-templates/fields'),
    ]);
    fields.value = fieldsResponse.data ?? [];
    if (route.query.create === '1') {
      openCreate();
      router.replace({ query: { ...route.query, create: undefined } });
    }
  } catch (err) {
    error.value = '文字模板暫時無法載入，請稍後重試';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <SettingsLayout title="文字模板" description="集中管理可插入健檢文字欄位的長篇內容；填表時不會自動跳出提示。">
    <template #actions><Button type="button" @click="openCreate"><Plus class="h-4 w-4" />新增文字模板</Button></template>

    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <ListSkeleton v-if="loading" :rows="5" />

    <template v-else>
      <SearchPanel id="text-template-search" v-model="query" label="搜尋文字模板" placeholder="搜尋模板名稱或內容">
        <div class="mt-3 flex flex-wrap items-center gap-3 px-1">
          <Select v-model="status"><SelectTrigger class="w-36" aria-label="模板狀態"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部狀態</SelectItem><SelectItem value="enabled">使用中</SelectItem><SelectItem value="disabled">已停用</SelectItem></SelectContent></Select>
          <Button v-if="query || status !== 'all'" type="button" variant="ghost" @click="query = ''; status = 'all'">清除篩選</Button>
        </div>
      </SearchPanel>

      <p class="text-sm text-muted-foreground">顯示 {{ visibleTemplates.length }} 份，共 {{ templates.length }} 份模板</p>
      <EmptyState v-if="!visibleTemplates.length" :icon="templates.length ? SearchX : FileText" :title="templates.length ? '找不到符合條件的文字模板' : '尚未建立文字模板'" description="建立後，填寫健檢的文字欄位便能從模板介面插入。"><Button type="button" class="mt-4" @click="openCreate">新增第一份模板</Button></EmptyState>

      <Card v-if="visibleTemplates.length" class="hidden gap-0 overflow-hidden py-0 shadow-sm xl:block">
        <Table><TableHeader><TableRow><TableHead>模板名稱</TableHead><TableHead>適用欄位</TableHead><TableHead>啟用</TableHead><TableHead class="text-right">操作</TableHead></TableRow></TableHeader>
          <TableBody><TableRow v-for="template in visibleTemplates" :key="template._id">
            <TableCell class="max-w-md"><button type="button" class="block w-full text-left" @click="openEdit(template)"><span class="block font-medium text-belle-600 dark:text-brand-400">{{ template.name }}</span><span class="block truncate text-xs text-muted-foreground">{{ template.content }}</span></button></TableCell>
            <TableCell class="max-w-64 truncate text-sm text-foreground" :title="applicabilityLabel(template)">{{ applicabilityLabel(template) }}</TableCell>
            <TableCell><Switch :model-value="template.enabled !== false" :aria-label="`啟用${template.name}`" @update:model-value="toggleEnabled(template, $event)" /></TableCell>
            <TableCell><div class="flex justify-end gap-1"><Button type="button" variant="ghost" size="icon" :aria-label="`編輯${template.name}`" @click="openEdit(template)"><Pencil class="h-4 w-4" /></Button><Button type="button" variant="ghost" size="icon" :aria-label="`複製${template.name}`" @click="duplicate(template)"><Copy class="h-4 w-4" /></Button><Button type="button" variant="destructive" size="icon" :aria-label="`刪除${template.name}`" @click="deleteTarget = template"><Trash2 class="h-4 w-4" /></Button></div></TableCell>
          </TableRow></TableBody>
        </Table>
      </Card>

      <div v-if="visibleTemplates.length" class="space-y-3 xl:hidden">
        <Card v-for="template in visibleTemplates" :key="template._id" class="p-4"><div class="flex items-start justify-between gap-3"><button type="button" class="min-w-0 flex-1 text-left" @click="openEdit(template)"><span class="font-semibold text-foreground">{{ template.name }}</span><span class="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">{{ template.content }}</span></button><Switch :model-value="template.enabled !== false" :aria-label="`啟用${template.name}`" @update:model-value="toggleEnabled(template, $event)" /></div><div class="mt-3 flex items-center gap-2 border-t border-border pt-3"><span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{{ applicabilityLabel(template) }}</span><Button type="button" variant="ghost" size="icon" @click="openEdit(template)"><Pencil class="h-4 w-4" /></Button><Button type="button" variant="destructive" size="icon" @click="deleteTarget = template"><Trash2 class="h-4 w-4" /></Button></div></Card>
      </div>
    </template>

    <ModalDialog v-if="editorOpen" size="lg" @close="editorOpen = false">
      <div class="space-y-1 p-6 pb-4 pr-16"><DialogTitle>{{ editingId ? '編輯文字模板' : '新增文字模板' }}</DialogTitle><DialogDescription>模板會原樣保留換行；插入時再決定放在游標、接在後面或覆蓋內容。</DialogDescription></div>
      <form @submit.prevent="save">
        <div class="space-y-5 px-6 pb-6">
          <Alert v-if="editorError" variant="destructive"><AlertDescription>{{ editorError }}</AlertDescription></Alert>
          <div class="space-y-1.5"><Label for="text-template-name">模板名稱</Label><Input id="text-template-name" v-model="form.name" maxlength="80" placeholder="例如：老年犬年度健檢建議" /></div>
          <div class="space-y-1.5"><Label for="text-template-content">模板內容</Label><Textarea id="text-template-content" v-model="form.content" class="min-h-64 whitespace-pre-wrap" maxlength="2000" placeholder="輸入要插入報告的完整文字內容…" /><p class="text-right text-xs tabular-nums text-muted-foreground">{{ form.content.length }} / 2,000</p></div>
          <div class="rounded-xl border border-border p-4"><div class="flex items-start justify-between gap-4"><div><p class="text-sm font-medium text-foreground">所有文字欄位皆可使用</p><p class="mt-1 text-xs text-muted-foreground">關閉後可指定一個或多個適用欄位。</p></div><Switch :model-value="form.availableForAllFields" aria-label="所有文字欄位皆可使用" @update:model-value="form.availableForAllFields = $event" /></div>
            <div v-if="!form.availableForAllFields" class="mt-4 border-t border-border pt-3">
              <div class="grid gap-2 sm:grid-cols-[minmax(0,220px)_1fr]">
                <Select v-model="fieldFormFilter">
                  <SelectTrigger class="w-full" aria-label="依表單篩選欄位"><SelectValue placeholder="選擇表單" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部表單</SelectItem>
                    <SelectItem v-for="formName in fieldFormOptions" :key="formName" :value="formName">{{ formName }}</SelectItem>
                  </SelectContent>
                </Select>
                <div class="relative">
                  <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input v-model="fieldQuery" type="search" class="pl-9" placeholder="搜尋欄位名稱" aria-label="搜尋適用欄位" />
                </div>
              </div>
              <div class="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>顯示 {{ filteredFields.length }} 個欄位</span>
                <span>已選 {{ form.applicableItemKeys.length }} 個</span>
              </div>
              <div class="mt-2 max-h-56 space-y-1 overflow-y-auto">
                <label v-for="field in filteredFields" :key="field.key" class="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-muted/30">
                  <input type="checkbox" class="h-4 w-4 accent-belle-600 dark:accent-brand-500" :checked="form.applicableItemKeys.includes(field.key)" @change="toggleField(field.key, $event.target.checked)" />
                  <span class="min-w-0"><span class="block text-sm text-foreground">{{ field.label }}</span><span class="block truncate text-xs text-muted-foreground">{{ field.forms.join('、') }}</span></span>
                </label>
                <p v-if="!fields.length" class="py-4 text-center text-sm text-muted-foreground">目前沒有可用的文字欄位。</p>
                <p v-else-if="!filteredFields.length" class="py-4 text-center text-sm text-muted-foreground">找不到符合條件的欄位。</p>
              </div>
            </div>
          </div>
          <div class="flex min-h-12 items-center justify-between rounded-xl border border-border px-4"><span><span class="block text-sm font-medium text-foreground">啟用模板</span><span class="block text-xs text-muted-foreground">停用後不會出現在填表選擇介面。</span></span><Switch :model-value="form.enabled" aria-label="啟用模板" @update:model-value="form.enabled = $event" /></div>
        </div>
        <DialogFooter><Button type="button" variant="outline" @click="editorOpen = false">取消</Button><Button type="submit" :disabled="saving">{{ saving ? '儲存中…' : '儲存模板' }}</Button></DialogFooter>
      </form>
    </ModalDialog>

    <ConfirmDialog :open="Boolean(deleteTarget)" title="刪除文字模板" :description="`確定要刪除「${deleteTarget?.name || ''}」嗎？已插入報告的文字不受影響。`" confirm-label="刪除模板" :loading="deleting" @update:open="(value) => !value && (deleteTarget = null)" @confirm="confirmDelete" />
  </SettingsLayout>
</template>
