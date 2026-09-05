<script setup>
import { computed, ref, watch } from 'vue';
import { ChevronRight, FilePlus2, Search, Trash2, Zap } from '@lucide/vue';
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
const expandedId = ref('');
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

watch(picker, (value) => {
  if (!value) return;
  query.value = '';
  scope.value = 'relevant';
  expandedId.value = '';
  creating.value = value.quickCreate === true;
  createError.value = '';
  form.value = { scope: 'field' };
});
watch(candidates, (list) => {
  if (expandedId.value && !list.some((template) => template._id === expandedId.value)) expandedId.value = '';
});

function toggleExpand(id) {
  expandedId.value = expandedId.value === id ? '' : id;
}

// 閃電鈕跟展開列裡的「插入」共用：有現有內容就插到游標處，沒有就直接取代——
// 不用先選取再到頁尾按鈕，點了就當場插入，不彈確認。
function quickInsert(template) {
  if (!picker.value) return;
  picker.value.onInsert?.(template, picker.value.currentText ? 'cursor' : 'replace');
  markUsed(template);
  closePicker();
}

function overwriteTemplate(template) {
  if (!picker.value) return;
  picker.value.onInsert?.(template, 'replace');
  markUsed(template);
  closePicker();
}

async function confirmDelete() {
  if (!deleteTarget.value || deleting.value) return;
  deleting.value = true;
  try {
    await deleteTemplate(deleteTarget.value._id);
    if (expandedId.value === deleteTarget.value._id) expandedId.value = '';
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
    expandedId.value = template._id;
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
        <p v-if="createError" class="rounded-lg border border-destructive/30 bg-destructive-surface px-3 py-2 text-sm text-destructive">{{ createError }}</p>
        <div class="rounded-xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground"><p class="font-medium text-foreground">{{ picker?.label || '目前欄位' }}</p><p class="mt-2 line-clamp-4 whitespace-pre-wrap">{{ picker?.currentText }}</p></div>
        <div class="space-y-1.5">
          <p class="text-sm font-medium text-foreground">適用範圍</p>
          <SegmentedControl v-model="form.scope" :options="CREATE_SCOPE_OPTIONS" aria-label="模板適用範圍" full-width />
        </div>
      </form>

      <div v-else class="flex min-h-0 flex-1 flex-col border-y border-border">
        <div class="space-y-3 p-4 pb-3">
          <div class="relative">
            <Search class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input v-model="query" type="text" class="pl-10" placeholder="搜尋模板名稱或內容" aria-label="搜尋文字模板" />
          </div>
          <SegmentedControl v-model="scope" :options="LIST_SCOPE_OPTIONS" aria-label="模板清單範圍" size="sm" full-width />
        </div>

        <div class="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4 md:max-h-[52vh]">
          <div
            v-for="template in candidates"
            :key="template._id"
            class="rounded-xl border transition-colors"
            :class="expandedId === template._id ? 'border-primary bg-accent/30' : 'border-border bg-card hover:border-primary/30'"
          >
            <div class="flex items-stretch gap-1 p-1">
              <button
                type="button"
                class="min-w-0 flex-1 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:translate-y-px"
                :aria-expanded="expandedId === template._id"
                :aria-label="`展開文字模板 ${template.name}`"
                @click="toggleExpand(template._id)"
              >
                <span class="flex items-center gap-1.5">
                  <ChevronRight
                    class="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform"
                    :class="expandedId === template._id ? 'rotate-90' : ''"
                    stroke-width="1.75"
                  />
                  <span class="min-w-0 truncate font-medium text-foreground">{{ template.name }}</span>
                </span>
                <span v-if="expandedId !== template._id" class="mt-0.5 line-clamp-1 block pl-5 text-xs text-muted-foreground">{{ template.content }}</span>
              </button>
              <div class="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-sm"
                  :aria-label="`直接插入文字模板 ${template.name}`"
                  @click.stop="quickInsert(template)"
                >
                  <Zap class="h-4 w-4" stroke-width="1.75" />
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="icon-sm"
                  :aria-label="`刪除文字模板 ${template.name}`"
                  @click.stop="deleteTarget = template"
                >
                  <Trash2 class="h-4 w-4" stroke-width="1.75" />
                </Button>
              </div>
            </div>
            <div v-if="expandedId === template._id" class="space-y-3 border-t border-border/70 px-3 pb-3 pt-3">
              <p class="whitespace-pre-wrap rounded-lg bg-field p-3 text-sm leading-7 text-foreground">{{ template.content }}</p>
              <div class="flex flex-wrap justify-end gap-2">
                <Button v-if="picker?.currentText" type="button" variant="destructive-outline" size="sm" @click="overwriteTemplate(template)">覆蓋內容</Button>
                <Button type="button" size="sm" @click="quickInsert(template)">{{ picker?.currentText ? '插入游標處' : '插入' }}</Button>
              </div>
            </div>
          </div>
          <p v-if="!candidates.length" class="py-8 text-center text-sm text-muted-foreground">{{ scope === 'relevant' ? '目前沒有適用此欄位的模板。' : '找不到符合條件的模板。' }}</p>
        </div>
      </div>

      <DialogFooter>
        <template v-if="creating">
          <Button type="button" variant="outline" :disabled="saving" @click="creating = false">返回模板清單</Button>
          <Button type="button" :disabled="saving" @click="saveTemplate">{{ saving ? '新增中…' : '新增模板' }}</Button>
        </template>
        <template v-else>
          <Button v-if="picker?.currentText" type="button" variant="secondary" class="mr-auto" @click="creating = true">
            <FilePlus2 class="h-4 w-4" stroke-width="1.75" />
            存成模板
          </Button>
          <Button type="button" variant="outline" @click="closePicker">取消</Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <ConfirmDialog
    :open="Boolean(deleteTarget)"
    title="刪除文字模板"
    :description="`確定要刪除「${deleteTarget?.name || ''}」嗎？已插入報告的文字不受影響。`"
    confirm-label="刪除模板"
    destructive
    :loading="deleting"
    @update:open="(value) => !value && (deleteTarget = null)"
    @confirm="confirmDelete"
  />
</template>
