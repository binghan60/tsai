<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Pencil } from '@lucide/vue';
import { http } from '../api/http';
import { getSocket } from '../api/socket';
import { useToast } from '../composables/useToast';
import { clinicDateInput, formatDateTime } from '../lib/datetime';
import Pagination from './Pagination.vue';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { DatePicker } from './ui/date-picker';
import { Textarea } from './ui/textarea';

const props = defineProps({
  notes: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  page: { type: Number, default: 1 },
  totalPages: { type: Number, default: 1 },
  petId: { type: [String, Number], default: '' },
  title: { type: String, default: '歷次病歷日誌' },
  emptyText: { type: String, default: '尚無其他病歷日誌' },
  unlinkedText: { type: String, default: '尚未連結病患資料，無法查看歷次日誌。' },
  fullRecordLabel: { type: String, default: '完整病歷' },
});

const emit = defineEmits(['load', 'saved']);
const toast = useToast();
const socket = getSocket();
const editingId = ref('');
const editingContent = ref('');
const editingDate = ref('');
const savingId = ref('');
const editError = ref('');

watch(() => props.notes, () => {
  if (!props.notes.some(note => String(note._id) === String(editingId.value))) cancelEdit();
});

function noteBelongsToPanel(note) {
  return props.petId && String(note?.petId || '') === String(props.petId);
}

function handleRemoteNoteUpdate(note) {
  if (noteBelongsToPanel(note)) emit('load', props.page);
}

onMounted(() => {
  socket.on('clinical-note:updated', handleRemoteNoteUpdate);
});

onBeforeUnmount(() => {
  socket.off('clinical-note:updated', handleRemoteNoteUpdate);
});

function startEdit(note) {
  editingId.value = note._id;
  editingContent.value = note.editableContent ?? note.content ?? '';
  editingDate.value = clinicDateInput(note.entryDate) || '';
  editError.value = '';
}

function cancelEdit() {
  editingId.value = '';
  editingContent.value = '';
  editingDate.value = '';
  editError.value = '';
}

async function saveEdit(note) {
  const content = editingContent.value.trim();
  if (!content || savingId.value) return;
  savingId.value = note._id;
  editError.value = '';
  try {
    const { data } = await http.put(`/clinical-notes/${note._id}`, { content, entryDate: editingDate.value || undefined });
    cancelEdit();
    toast.success('已更新病歷日誌');
    emit('saved', { note, updated: data, content });
  } catch (err) {
    editError.value = err.response?.data?.message || '病歷日誌更新失敗，請重試。';
    toast.error(editError.value);
  } finally {
    savingId.value = '';
  }
}
</script>

<template>
  <section class="rounded-xl border border-border bg-field/60 p-4">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-sm font-semibold sm:text-base">{{ title }}</h3>
      <Button v-if="petId" as-child variant="secondary" size="xs">
        <router-link :to="`/pets/${petId}`">{{ fullRecordLabel }}</router-link>
      </Button>
    </div>

    <p v-if="!petId" class="mt-3 text-sm text-muted-foreground">{{ unlinkedText }}</p>
    <p v-else-if="loading" class="mt-3 text-sm text-muted-foreground" role="status">載入病歷日誌中…</p>
    <Alert v-else-if="error" variant="destructive" class="mt-3">
      <AlertDescription>{{ error }}</AlertDescription>
      <Button variant="secondary" size="sm" @click="emit('load', page)">重試</Button>
    </Alert>

    <template v-else>
      <article v-for="note in notes" :key="note._id" class="mt-3 border-t border-border pt-3 first:border-t-0">
        <template v-if="editingId === note._id">
          <div class="grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
            <label class="block space-y-1.5 text-xs font-medium">
              日期
              <DatePicker v-model="editingDate" aria-label="病歷日誌日期" />
            </label>
            <label class="block space-y-1.5 text-xs font-medium">
              內容
              <Textarea v-model="editingContent" rows="5" :disabled="savingId === note._id" aria-label="病歷日誌內容" />
            </label>
          </div>
          <Alert v-if="editError" variant="destructive" class="mt-3"><AlertDescription>{{ editError }}</AlertDescription></Alert>
          <div class="mt-3 flex justify-end gap-2">
            <Button variant="secondary" size="sm" :disabled="savingId === note._id" @click="cancelEdit">取消</Button>
            <Button size="sm" :disabled="savingId === note._id || !editingContent.trim()" @click="saveEdit(note)">儲存</Button>
          </div>
        </template>
        <template v-else>
          <div class="flex items-start justify-between gap-3">
            <p class="text-xs text-muted-foreground">{{ formatDateTime(note.entryDate) }}</p>
            <Button variant="secondary" size="xs" @click="startEdit(note)"><Pencil class="h-3.5 w-3.5" />修改</Button>
          </div>
          <p class="mt-1 whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed">{{ note.content }}</p>
        </template>
      </article>
      <p v-if="!notes.length" class="mt-3 text-sm text-muted-foreground">{{ emptyText }}</p>
      <Pagination v-if="totalPages > 1" class="mt-4" :page="page" :total-pages="totalPages" @update:page="next => emit('load', next)" />
    </template>
  </section>
</template>
