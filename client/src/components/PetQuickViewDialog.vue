<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { PawPrint, Phone, Pin, PinOff } from '@lucide/vue';
import { http } from '../api/http';
import { usePinnedPetsStore } from '../stores/pinnedPets';
import { useStaffIdentity } from '../composables/useStaffIdentity';
import { useToast } from '../composables/useToast';
import { ageLabel, formatDate } from '../lib/datetime';
import { DELIVERY_STATUS_META, RECORD_STATUS_META, getDeliveryStatus, isFinalizedRecord } from '../lib/recordStatus';
import ModalDialog from './ModalDialog.vue';
import ClinicalNotesPanel from './ClinicalNotesPanel.vue';
import FilterTabs from './FilterTabs.vue';
import ListSkeleton from './ListSkeleton.vue';
import EmptyState from './EmptyState.vue';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { DialogDescription, DialogTitle } from './ui/dialog';

// 寵物暫存區的病歷速覽：櫃台接電話問醫生時，醫生不用離開手上的診療台就能看病歷。
// 全站只在 App.vue 掛一份，由 pinnedPets store 的 quickViewPetId 開關。
const store = usePinnedPetsStore();
const route = useRoute();
const toast = useToast();
const { identity } = useStaffIdentity();

const pet = ref(null);
const loading = ref(false);
const error = ref('');
const tab = ref('notes');
const notes = ref([]);
const notePage = ref(1);
const noteTotalPages = ref(1);
const notesLoading = ref(false);
const notesError = ref('');
const pinBusy = ref(false);
let request = 0;
let notesRequest = 0;

const petId = computed(() => store.quickViewPetId);
const owner = computed(() => pet.value?.ownerId ?? null);
const pinned = computed(() => store.isPinned(petId.value));
const tabItems = [
  { key: 'notes', label: '病歷日誌' },
  { key: 'records', label: '健檢報告' },
];

const SEX_LABELS = { male: '公', female: '母' };
const NEUTERED_LABELS = { yes: '已結紮', no: '未結紮' };
const summary = computed(() => [
  pet.value?.species,
  pet.value?.breed,
  SEX_LABELS[pet.value?.sex],
  NEUTERED_LABELS[pet.value?.neutered],
  ageLabel(pet.value?.birthDate, new Date(), ''),
  pet.value?.weightKg != null ? `${pet.value.weightKg} kg` : '',
].filter(Boolean).join(' · '));
// 醫生回答用藥問題前最需要先看到的兩件事，跟寵物詳情頁一樣用警示色。
const alertFields = computed(() => [
  { label: '病史', value: [pet.value?.medicalHistory?.join('、'), pet.value?.medicalHistoryOther].filter(Boolean).join('；') },
  { label: '藥物過敏', value: pet.value?.allergyStatus === 'yes' ? `有${pet.value.allergyType ? `，${pet.value.allergyType}` : ''}` : pet.value?.allergyStatus === 'none' ? '無過敏' : '' },
].filter((field) => field.value));

async function loadPet(id) {
  const token = ++request;
  pet.value = null;
  error.value = '';
  loading.value = true;
  try {
    const { data } = await http.get(`/pets/${id}`);
    if (token === request) pet.value = data;
  } catch (err) {
    if (token === request) error.value = err.response?.status === 404 ? '找不到這隻寵物，可能已被刪除。' : '寵物資料未能載入，請重試。';
  } finally {
    if (token === request) loading.value = false;
  }
}

async function loadNotes(page = 1) {
  const id = petId.value;
  const token = ++notesRequest;
  if (!id) return;
  notesLoading.value = true;
  notesError.value = '';
  try {
    const { data } = await http.get(`/pets/${id}/clinical-notes`, { params: { page, limit: 5 } });
    if (token !== notesRequest) return;
    const totalPages = data.totalPages || 1;
    if (page > totalPages) return await loadNotes(totalPages);
    notes.value = data.items || [];
    notePage.value = page;
    noteTotalPages.value = totalPages;
  } catch {
    if (token === notesRequest) notesError.value = '病歷日誌未能載入，請重試。';
  } finally {
    if (token === notesRequest) notesLoading.value = false;
  }
}

watch(petId, (id) => {
  tab.value = 'notes';
  notes.value = [];
  notePage.value = 1;
  if (!id) return;
  loadPet(id);
  loadNotes(1);
}, { immediate: true });

// 點「完整病歷」或報告連結會換頁，Modal 跟著關掉，不要蓋在新頁面上。
watch(() => route.fullPath, () => store.closeQuickView());

function recordLink(record) {
  return isFinalizedRecord(record) ? `/records/${record._id}/preview` : `/records/${record._id}/edit`;
}

async function togglePin() {
  if (pinBusy.value || !petId.value) return;
  pinBusy.value = true;
  try {
    if (pinned.value) {
      await store.unpin(petId.value);
      toast.success('已從暫存區移除');
    } else {
      await store.pin(petId.value, identity.value);
      toast.success('已加入暫存區');
    }
  } catch (err) {
    toast.error(err.response?.data?.message || '暫存區更新失敗，請稍後再試');
  } finally {
    pinBusy.value = false;
  }
}
</script>

<template>
  <ModalDialog v-if="petId" size="lg" @close="store.closeQuickView()">
    <div class="space-y-4 p-6 sm:p-7">
      <div class="flex items-start gap-3 pr-10">
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"><PawPrint class="h-5 w-5" stroke-width="1.75" /></span>
        <div class="min-w-0">
          <DialogTitle class="flex flex-wrap items-center gap-2">
            <span>{{ pet?.name ?? '病歷速覽' }}</span>
            <span v-if="pet?.medicalRecordNumber" class="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{{ pet.medicalRecordNumber }}</span>
          </DialogTitle>
          <DialogDescription class="mt-0.5 text-xs">{{ summary || '病歷速覽' }}</DialogDescription>
        </div>
      </div>

      <ListSkeleton v-if="loading" :rows="3" />
      <Alert v-else-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>

      <template v-else-if="pet">
        <div v-if="owner" class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-field px-3 py-2 text-sm">
          <span><span class="text-muted-foreground">飼主</span> <span class="font-medium">{{ owner.name }}</span></span>
          <a v-if="owner.phone" :href="`tel:${owner.phone}`" class="inline-flex items-center gap-1 font-medium text-primary tabular-nums"><Phone class="h-3.5 w-3.5" stroke-width="1.75" />{{ owner.phone }}</a>
          <span v-if="owner.landline" class="tabular-nums text-muted-foreground">市話 {{ owner.landline }}</span>
        </div>

        <dl v-if="alertFields.length || pet.notes" class="space-y-1.5 text-sm">
          <div v-for="field in alertFields" :key="field.label" class="flex gap-2 rounded-lg bg-warning-surface px-3 py-2 text-warning">
            <dt class="shrink-0 font-medium">{{ field.label }}</dt>
            <dd class="min-w-0 wrap-anywhere">{{ field.value }}</dd>
          </div>
          <div v-if="pet.notes" class="flex gap-2 rounded-lg bg-muted px-3 py-2">
            <dt class="shrink-0 font-medium">備註</dt>
            <dd class="min-w-0 whitespace-pre-wrap wrap-anywhere">{{ pet.notes }}</dd>
          </div>
        </dl>

        <FilterTabs v-model="tab" :items="tabItems" :counts="{ records: pet.recordPagination?.total }" aria-label="病歷速覽內容" />

        <ClinicalNotesPanel
          v-if="tab === 'notes'"
          :notes="notes"
          :loading="notesLoading"
          :error="notesError"
          :page="notePage"
          :total-pages="noteTotalPages"
          :pet-id="petId"
          title="病歷日誌"
          empty-text="尚無病歷日誌"
          @load="loadNotes"
          @saved="loadNotes(notePage)"
        />

        <template v-else>
          <EmptyState v-if="!pet.medicalRecords?.length" :icon="PawPrint" title="尚無健檢報告" inset />
          <ul v-else class="divide-y divide-border rounded-xl border border-border">
            <li v-for="record in pet.medicalRecords" :key="record._id">
              <router-link :to="recordLink(record)" class="flex flex-wrap items-center gap-2 px-4 py-3 hover:bg-field">
                <span class="font-medium text-primary">{{ record.examType || '健檢報告' }}</span>
                <span class="text-xs tabular-nums text-muted-foreground">{{ formatDate(record.visitDate) }}</span>
                <span class="ml-auto flex items-center gap-1.5">
                  <Badge variant="status" :class="RECORD_STATUS_META[record.status]?.class">{{ RECORD_STATUS_META[record.status]?.label ?? record.status }}</Badge>
                  <Badge v-if="isFinalizedRecord(record)" variant="status" :class="DELIVERY_STATUS_META[getDeliveryStatus(record)]?.class">{{ DELIVERY_STATUS_META[getDeliveryStatus(record)]?.label }}</Badge>
                </span>
              </router-link>
            </li>
          </ul>
          <p v-if="(pet.recordPagination?.total ?? 0) > (pet.medicalRecords?.length ?? 0)" class="text-xs text-muted-foreground">只列出最近 {{ pet.medicalRecords.length }} 份，其餘請到完整病歷查看。</p>
        </template>
      </template>
    </div>

    <div class="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-border bg-card px-6 py-4 sm:px-7">
      <Button type="button" :variant="pinned ? 'destructive' : 'secondary'" :disabled="pinBusy || !!error" @click="togglePin">
        <component :is="pinned ? PinOff : Pin" class="h-4 w-4" stroke-width="1.75" />{{ pinned ? '從暫存區移除' : '加入暫存區' }}
      </Button>
      <Button as-child>
        <router-link :to="`/pets/${petId}`">開啟完整病歷</router-link>
      </Button>
    </div>
  </ModalDialog>
</template>
