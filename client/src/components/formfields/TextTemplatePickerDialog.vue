<script setup>
import { computed, ref, watch } from 'vue';
import { Check, FilePlus2, FileText, Search, Trash2 } from '@lucide/vue';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import ConfirmDialog from '../ConfirmDialog.vue';
import { useTextTemplates } from '../../composables/useTextTemplates';
import { useToast } from '../../composables/useToast';
import SegmentedControl from '../SegmentedControl.vue';

const { picker, closePicker, createTemplate, templates, templatesFor, markUsed, deleteTemplate } = useTextTemplates();
const toast = useToast();
const query = ref('');
const scope = ref('relevant');
const selectedId = ref('');
const creating = ref(false);
const saving = ref(false);
const createError = ref('');
const form = ref({ scope: 'field' });
const deleteTarget = ref(null);
const deleting = ref(false);
const CREATE_SCOPE_OPTIONS = [
  { value: 'field', label: '適用此欄位' },
  { value: 'all', label: '通用' },
];
const LIST_SCOPE_OPTIONS = [
  { value: 'relevant', label: '適用此欄位' },
  { value: 'all', label: '全部模板' },
];

const candidates = computed(() => {
  if (!picker.value) return [];
  const keyword = query.value.trim().toLowerCase();
  return templatesFor(picker.value.itemKey, { all: scope.value === 'all' })
    .filter((template) => !keyword || `${template.name} ${template.content}`.toLowerCase().includes(keyword));
});
const selected = computed(() => candidates.value.find((template) => template._id === selectedId.value) ?? null);

watch(picker, (value) => {
  if (!value) return;
  query.value = '';
  scope.value = 'relevant';
  selectedId.value = '';
  creating.value = value.quickCreate === true;
  createError.value = '';
  form.value = { scope: 'field' };
});
watch(candidates, (list) => {
  if (selectedId.value && !list.some((template) => template._id === selectedId.value)) selectedId.value = '';
});

function insert(mode) {
  if (!selected.value || !picker.value) return;
  picker.value.onInsert?.(selected.value, mode);
  markUsed(selected.value);
  closePicker();
}

async function confirmDelete() {
  if (!deleteTarget.value || deleting.value) return;
  deleting.value = true;
  try {
    await deleteTemplate(deleteTarget.value._id);
    if (selectedId.value === deleteTarget.value._id) selectedId.value = '';
    toast.success(`已刪除「${deleteTarget.value.name}」`);
    deleteTarget.value = null;
  } catch (err) {
    toast.error(err.response?.data?.message ?? '刪除文字模板失敗');
  } finally {
    deleting.value = false;
  }
}

function nextTemplateName() {
  const label = String(picker.value?.label ?? '文字模板').trim() || '文字模板';
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sequence = templates.value.reduce((largest, template) => {
    const match = String(template.name ?? '').match(new RegExp(`^${escapedLabel}\\s+(\\d+)$`));
    return match ? Math.max(largest, Number(match[1])) : largest;
  }, 0) + 1;
  return `${label} ${sequence}`.slice(0, 80);
}

async function saveTemplate() {
  if (!picker.value || saving.value) return;
  saving.value = true;
  createError.value = '';
  try {
    const template = await createTemplate({
      name: nextTemplateName(),
      content: picker.value.currentText,
      availableForAllFields: form.value.scope === 'all',
      applicableItemKeys: form.value.scope === 'all' ? [] : [picker.value.itemKey],
      enabled: true,
    });
    scope.value = 'relevant';
    selectedId.value = template._id;
    creating.value = false;
  } catch (err) {
    createError.value = err.response?.data?.message ?? '新增文字模板失敗，請稍後再試。';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog :open="Boolean(picker)" @update:open="(value) => !value && closePicker()">
    <DialogContent size="lg" class="max-h-[90vh] flex flex-col">
      <div class="p-6 pb-4 pr-16">
        <div class="space-y-1.5">
          <DialogTitle>{{ creating ? '新增文字模板' : '插入文字模板' }}</DialogTitle>
          <DialogDescription>{{ creating ? '會直接使用目前輸入框的文字建立模板。' : (picker?.label ? `選擇要插入「${picker.label}」的內容。` : '選擇要插入欄位的內容。') }}</DialogDescription>
        </div>
      </div>

      <form v-if="creating" class="min-h-0 flex-1 space-y-5 border-y border-border p-6" @submit.prevent="saveTemplate">
        <p v-if="createError" class="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{{ createError }}</p>
        <div class="rounded-xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground"><p class="font-medium text-foreground">{{ picker?.label || '目前欄位' }}</p><p class="mt-2 line-clamp-4 whitespace-pre-wrap">{{ picker?.currentText }}</p></div>
        <div class="space-y-1.5">
          <p class="text-sm font-medium text-foreground">適用範圍</p>
          <SegmentedControl v-model="form.scope" :options="CREATE_SCOPE_OPTIONS" aria-label="模板適用範圍" full-width />
        </div>
      </form>

      <div v-else class="grid min-h-0 flex-1 border-y border-border md:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.1fr)]">
        <div class="flex min-h-0 flex-col border-b border-border p-4 md:border-b-0 md:border-r">
          <div class="relative">
            <Search class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input v-model="query" type="search" class="pl-10" placeholder="搜尋模板名稱或內容" aria-label="搜尋文字模板" />
          </div>
          <SegmentedControl v-model="scope" class="mt-3" :options="LIST_SCOPE_OPTIONS" aria-label="模板清單範圍" size="sm" full-width />
          <div class="mt-3 max-h-72 space-y-2 overflow-y-auto md:max-h-[46vh]">
            <div
              v-for="template in candidates"
              :key="template._id"
              class="grid w-full grid-cols-[minmax(0,1fr)_2.75rem] items-start gap-1 rounded-xl border bg-card p-1 shadow-sm transition-colors"
              :class="selectedId === template._id ? 'border-primary' : 'border-border'"
            >
              <button
                type="button"
                class="min-h-16 w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:translate-y-px"
                :class="selectedId === template._id ? 'bg-accent' : 'bg-field/70'"
                :aria-pressed="selectedId === template._id"
                :aria-label="`選取文字模板 ${template.name}`"
                @click="selectedId = template._id"
              >
                <span class="flex items-center justify-between gap-2">
                  <span class="min-w-0 truncate font-medium text-foreground">{{ template.name }}</span>
                  <span v-if="selectedId === template._id" class="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
                    <Check class="h-3.5 w-3.5" stroke-width="1.75" />已選取
                  </span>
                </span>
                <span class="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">{{ template.content }}</span>
              </button>
              <Button
                type="button"
                variant="destructive"
                size="icon"
                :aria-label="`刪除文字模板 ${template.name}`"
                @click.stop="deleteTarget = template"
              >
                <Trash2 class="h-4 w-4" stroke-width="1.75" />
              </Button>
            </div>
            <p v-if="!candidates.length" class="py-8 text-center text-sm text-muted-foreground">{{ scope === 'relevant' ? '目前沒有適用此欄位的模板。' : '找不到符合條件的模板。' }}</p>
          </div>
        </div>

        <div class="min-h-48 overflow-y-auto p-5 md:max-h-[62vh]">
          <template v-if="selected">
            <h3 class="text-base font-semibold text-foreground">{{ selected.name }}</h3>
            <div class="mt-4 whitespace-pre-wrap rounded-xl border border-border bg-field p-4 text-sm leading-7 text-foreground">{{ selected.content }}</div>
          </template>
          <div v-else class="flex min-h-48 flex-col items-center justify-center text-center text-muted-foreground">
            <FileText class="h-8 w-8" stroke-width="1.5" />
            <p class="mt-3 text-sm">先從左側選擇模板，再確認完整內容。</p>
          </div>
        </div>
      </div>

      <DialogFooter>
        <template v-if="creating">
          <Button type="button" variant="outline" :disabled="saving" @click="creating = false">返回模板清單</Button>
          <Button type="button" :disabled="saving" @click="saveTemplate">{{ saving ? '新增中…' : '新增模板' }}</Button>
        </template>
        <template v-else>
          <Button v-if="picker?.currentText" type="button" variant="ghost" class="mr-auto" @click="creating = true">
            <FilePlus2 class="h-4 w-4" stroke-width="1.75" />
            將目前內容存成模板
          </Button>
          <Button type="button" variant="outline" @click="closePicker">取消</Button>
          <Button v-if="picker?.currentText" type="button" variant="destructive-outline" :disabled="!selected" @click="insert('replace')">覆蓋</Button>
          <Button type="button" :disabled="!selected" @click="insert(picker?.currentText ? 'cursor' : 'replace')">插入</Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <ConfirmDialog
    :open="Boolean(deleteTarget)"
    title="刪除文字模板"
    :description="`確定要刪除「${deleteTarget?.name || ''}」嗎？已插入報告的文字不受影響。`"
    confirm-label="刪除模板"
    :loading="deleting"
    @update:open="(value) => !value && (deleteTarget = null)"
    @confirm="confirmDelete"
  />
</template>
