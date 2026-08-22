<script setup>
import { computed, ref, watch } from 'vue';
import { FileText, Search } from '@lucide/vue';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { useTextTemplates } from '../../composables/useTextTemplates';

const { picker, closePicker, templatesFor, markUsed } = useTextTemplates();
const query = ref('');
const scope = ref('relevant');
const selectedId = ref('');

const CATEGORY_LABELS = {
  conclusion: '結論',
  care: '照護建議',
  history: '病史',
  exam: '檢查說明',
  other: '其他',
};

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
</script>

<template>
  <Dialog :open="Boolean(picker)" @update:open="(value) => !value && closePicker()">
    <DialogContent size="lg" class="max-h-[90vh] flex flex-col">
      <div class="space-y-1.5 p-6 pb-4 pr-16">
        <DialogTitle>插入文字模板</DialogTitle>
        <DialogDescription>{{ picker?.label ? `選擇要插入「${picker.label}」的內容。` : '選擇要插入欄位的內容。' }}</DialogDescription>
      </div>

      <div class="grid min-h-0 flex-1 border-y border-border md:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.1fr)]">
        <div class="flex min-h-0 flex-col border-b border-border p-4 md:border-b-0 md:border-r">
          <div class="relative">
            <Search class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input v-model="query" type="search" class="pl-10" placeholder="搜尋模板名稱或內容" aria-label="搜尋文字模板" />
          </div>
          <div class="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-muted/30 p-1">
            <button type="button" class="min-h-9 rounded-md px-2 text-sm font-medium" :class="scope === 'relevant' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'" @click="scope = 'relevant'">適用此欄位</button>
            <button type="button" class="min-h-9 rounded-md px-2 text-sm font-medium" :class="scope === 'all' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'" @click="scope = 'all'">全部模板</button>
          </div>
          <div class="mt-3 max-h-72 space-y-2 overflow-y-auto md:max-h-[46vh]">
            <button
              v-for="template in candidates"
              :key="template._id"
              type="button"
              class="w-full rounded-xl border p-3 text-left transition-colors"
              :class="selectedId === template._id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30'"
              @click="selectedId = template._id"
            >
              <span class="flex items-start justify-between gap-2">
                <span class="font-medium text-foreground">{{ template.name }}</span>
                <Badge variant="outline" class="shrink-0">{{ CATEGORY_LABELS[template.category] }}</Badge>
              </span>
              <span class="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">{{ template.content }}</span>
            </button>
            <p v-if="!candidates.length" class="py-8 text-center text-sm text-muted-foreground">{{ scope === 'relevant' ? '目前沒有適用此欄位的模板。' : '找不到符合條件的模板。' }}</p>
          </div>
        </div>

        <div class="min-h-48 overflow-y-auto p-5 md:max-h-[62vh]">
          <template v-if="selected">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-base font-semibold text-foreground">{{ selected.name }}</h3>
              <Badge variant="outline">{{ CATEGORY_LABELS[selected.category] }}</Badge>
            </div>
            <div class="mt-4 whitespace-pre-wrap rounded-xl border border-border bg-field p-4 text-sm leading-7 text-foreground">{{ selected.content }}</div>
          </template>
          <div v-else class="flex min-h-48 flex-col items-center justify-center text-center text-muted-foreground">
            <FileText class="h-8 w-8" stroke-width="1.5" />
            <p class="mt-3 text-sm">先從左側選擇模板，再確認完整內容。</p>
          </div>
        </div>
      </div>

      <DialogFooter class="flex-wrap items-center">
        <Button as-child type="button" variant="ghost" class="sm:mr-auto"><router-link to="/settings/text-templates?create=1" target="_blank">新增／管理模板</router-link></Button>
        <Button type="button" variant="outline" @click="closePicker">取消</Button>
        <template v-if="picker?.currentText">
          <Button type="button" variant="destructive-outline" :disabled="!selected" @click="insert('replace')">覆蓋目前內容</Button>
          <Button type="button" variant="outline" :disabled="!selected" @click="insert('append')">接在內容後面</Button>
          <Button type="button" :disabled="!selected" @click="insert('cursor')">插入游標位置</Button>
        </template>
        <Button v-else type="button" :disabled="!selected" @click="insert('replace')">插入模板</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
