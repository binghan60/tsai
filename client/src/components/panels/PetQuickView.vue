<script setup>
import { usePetClinicalNotes } from '../../composables/usePetClinicalNotes';
import { apiErrorMessage } from '../../lib/apiError';
import { computed, ref, watch } from 'vue';
import PatientLink from '../PatientLink.vue';
import { useRoute } from 'vue-router';
import { Cat, Pin, PinOff } from '@lucide/vue';
import { http } from '../../api/http';
import { usePinnedPetsStore } from '../../stores/pinnedPets';
import { useStaffIdentity } from '../../composables/useStaffIdentity';
import { useToast } from '../../composables/useToast';
import { ageLabel, formatDate } from '../../lib/datetime';
import { DELIVERY_STATUS_META, RECORD_STATUS_META, getDeliveryStatus, isFinalizedRecord } from '../../lib/recordStatus';
import { medicalHistoryText } from '../../lib/petDisplay';
import SidePanel from './SidePanel.vue';
import SpecGrid from '../SpecGrid.vue';
import SpecCell from '../SpecCell.vue';
import PetSex from '../PetSex.vue';
import ClinicalNotesPanel from '../ClinicalNotesPanel.vue';
import FilterTabs from '../FilterTabs.vue';
import ListSkeleton from '../ListSkeleton.vue';
import EmptyState from '../EmptyState.vue';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { catBreedLabel } from '../../../../shared/catBreeds.js';

// 病歷速覽：櫃台接電話問醫師時，醫師不用離開手上的工作就能看這隻貓的病歷。
// 在暫存區面板裡推入的一層，聊天室與待辦的 # 標記也開這裡。唯讀為主，要改資料就開完整病歷。
const props = defineProps({
  petId: { type: String, required: true },
  canBack: { type: Boolean, default: false },
});
const emit = defineEmits(['back', 'close']);

const store = usePinnedPetsStore();
const route = useRoute();
const toast = useToast();
const { identity } = useStaffIdentity();

const pet = ref(null);
const loading = ref(false);
const error = ref('');
const tab = ref('notes');
const { notes, page: notePage, totalPages: noteTotalPages, loading: notesLoading, error: notesError, load: loadNotes } = usePetClinicalNotes({
  petId: () => props.petId,
});
const pinBusy = ref(false);
let request = 0;

const owner = computed(() => pet.value?.ownerId ?? null);
const pinned = computed(() => store.isPinned(props.petId));
const tabItems = [
  { key: 'notes', label: '病歷日誌' },
  { key: 'records', label: '健檢報告' },
];
const age = computed(() => ageLabel(pet.value?.birthDate, new Date(), '', { estimated: pet.value?.birthDateEstimated }));
// 醫師回答用藥問題前最需要先看到的兩件事：藥物過敏用危險色，病史用警示色。
const allergy = computed(() => (pet.value?.allergyStatus === 'yes' ? `有${pet.value.allergyType ? `：${pet.value.allergyType}` : ''}` : ''));
const history = computed(() => medicalHistoryText(pet.value));

async function loadPet(id) {
  const token = ++request;
  pet.value = null;
  error.value = '';
  loading.value = true;
  try {
    const { data } = await http.get(`/pets/${id}`);
    if (token === request) pet.value = data;
  } catch (err) {
    if (token === request) error.value = err.response?.status === 404 ? '找不到這隻貓咪，可能已被刪除。' : '貓咪資料未能載入，請重試。';
  } finally {
    if (token === request) loading.value = false;
  }
}

watch(() => props.petId, (id) => {
  tab.value = 'notes';
  loadPet(id);
  loadNotes(1);
}, { immediate: true });

// 點「完整病歷」或報告連結會換頁：面板留著，但退回暫存清單，別讓速覽蓋在新頁面的同一隻貓上。
watch(() => route.fullPath, () => emit('back'));

function recordLink(record) {
  return isFinalizedRecord(record) ? `/records/${record._id}/preview` : `/records/${record._id}/edit`;
}

async function togglePin() {
  if (pinBusy.value) return;
  pinBusy.value = true;
  try {
    if (pinned.value) {
      await store.unpin(props.petId);
      toast.success('已從暫存區移除');
    } else {
      await store.pin(props.petId, identity.value);
      toast.success('已加入暫存區');
    }
  } catch (err) {
    toast.error(apiErrorMessage(err, '暫存區更新失敗，請稍後再試'));
  } finally {
    pinBusy.value = false;
  }
}
</script>

<template>
  <SidePanel :title="pet?.name ?? '病歷速覽'" :can-back="canBack" back-label="返回暫存區" @back="emit('back')" @close="emit('close')">
    <ListSkeleton v-if="loading" :rows="3" inset />
    <Alert v-else-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>

    <div v-else-if="pet" class="space-y-5">
      <SpecGrid>
        <SpecCell label="品種">{{ catBreedLabel(pet.breed) || pet.species }}</SpecCell>
        <SpecCell v-if="pet.sex === 'male' || pet.sex === 'female'" label="性別"><PetSex :sex="pet.sex" :neutered="pet.neutered" with-label /></SpecCell>
        <SpecCell v-if="age" label="年齡">{{ age }}</SpecCell>
        <SpecCell v-if="pet.weightKg != null" label="體重" mono>{{ pet.weightKg }} kg</SpecCell>
      </SpecGrid>
      <SpecGrid v-if="owner">
        <SpecCell label="飼主"><PatientLink :pet-id="pet._id" quiet>{{ owner.name }}</PatientLink></SpecCell>
        <SpecCell v-if="owner.phone" label="電話" mono><a :href="`tel:${owner.phone}`" class="text-primary">{{ owner.phone }}</a></SpecCell>
        <SpecCell v-if="owner.landline" label="市話" mono>{{ owner.landline }}</SpecCell>
      </SpecGrid>

      <dl v-if="allergy || history || pet.notes" class="space-y-1.5 text-base">
        <div v-if="allergy" class="flex gap-3 rounded-lg bg-danger-surface px-3 py-2 text-danger">
          <dt class="shrink-0 font-semibold">藥物過敏</dt><dd class="min-w-0 wrap-anywhere">{{ allergy }}</dd>
        </div>
        <div v-if="history" class="flex gap-3 rounded-lg bg-warning-surface px-3 py-2 text-warning">
          <dt class="shrink-0 font-semibold">病史</dt><dd class="min-w-0 wrap-anywhere">{{ history }}</dd>
        </div>
        <div v-if="pet.notes" class="flex gap-3 rounded-lg bg-sunken px-3 py-2">
          <dt class="shrink-0 font-semibold">備註</dt><dd class="min-w-0 whitespace-pre-wrap wrap-anywhere">{{ pet.notes }}</dd>
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
        <EmptyState v-if="!pet.medicalRecords?.length" :icon="Cat" title="尚無健檢報告" inset />
        <ul v-else class="divide-y divide-border rounded-xl border border-border">
          <li v-for="record in pet.medicalRecords" :key="record._id">
            <router-link :to="recordLink(record)" class="flex flex-col gap-1.5 px-4 py-3 hover:bg-hover">
              <span class="flex items-baseline justify-between gap-3">
                <span class="truncate font-semibold text-primary">{{ record.examType || '健檢報告' }}</span>
                <span class="num shrink-0 text-sm text-subtle-foreground">{{ formatDate(record.visitDate) }}</span>
              </span>
              <span class="flex items-center gap-1.5">
                <Badge variant="status" :class="RECORD_STATUS_META[record.status]?.class">{{ RECORD_STATUS_META[record.status]?.label ?? record.status }}</Badge>
                <Badge v-if="isFinalizedRecord(record)" variant="status" :class="DELIVERY_STATUS_META[getDeliveryStatus(record)]?.class">{{ DELIVERY_STATUS_META[getDeliveryStatus(record)]?.label }}</Badge>
              </span>
            </router-link>
          </li>
        </ul>
        <p v-if="(pet.recordPagination?.total ?? 0) > (pet.medicalRecords?.length ?? 0)" class="text-sm text-muted-foreground">只列出最近 {{ pet.medicalRecords.length }} 份，其餘請到完整病歷查看。</p>
      </template>
    </div>

    <template #footer>
      <Button :variant="pinned ? 'destructive' : 'secondary'" :disabled="pinBusy || !!error" @click="togglePin">
        <component :is="pinned ? PinOff : Pin" stroke-width="1.75" />{{ pinned ? '移出暫存區' : '加入暫存區' }}
      </Button>
      <Button as-child>
        <router-link :to="`/pets/${petId}`">開啟完整病歷</router-link>
      </Button>
    </template>
  </SidePanel>
</template>
