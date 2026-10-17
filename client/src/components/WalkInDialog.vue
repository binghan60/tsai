<script setup>
import { computed, ref, watch } from 'vue';
import { Cat, Zap } from '@lucide/vue';
import ModalDialog from './ModalDialog.vue';
import SegmentedControl from './SegmentedControl.vue';
import CandidateSearchField from './CandidateSearchField.vue';
import StrayBadge from './StrayBadge.vue';
import { DialogFooter } from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { breedText } from '../lib/petDisplay';
import { duplicateBookings } from '../lib/receptionBoard';
import { checkMobilePhone } from '../../../shared/phone.js';

// 現場加看：沒有掛號、空檔幫忙看的（流浪貓常是這樣）。按下去就報到（POST /appointments/walk-in）。
// 貓咪是已建檔的貓，或當場建一隻新的流浪貓（帶貓的人：院內／既有飼主／新的人）。
// 新的一般病患照舊走掛號＋初診表，這裡不收。
const props = defineProps({
  // 今天的掛號（掛號台已經載入的那一天）：選到今天已經掛了號的貓要擋下，請從那一筆報到。
  dayItems: { type: Array, default: () => [] },
  templates: { type: Array, default: () => [] },
  defaultTemplateId: { type: String, default: '' },
  suggestedCheckinNumber: { type: Number, default: 1 },
  // 住院頁的「新增住院」：同一個視窗，來院原因改叫住院原因，不問號碼牌（伺服器配），送出時多帶 admit。
  admit: { type: Boolean, default: false },
  submitting: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
});
const emit = defineEmits(['submit', 'close']);

const PET_MODE_OPTIONS = [
  { value: 'existing', label: '已建檔的貓' },
  { value: 'stray', label: '新的流浪貓' },
];
const SEX_OPTIONS = [
  { value: 'male', label: '公' },
  { value: 'female', label: '母' },
  { value: 'unknown', label: '不明' },
];
const BRINGER_OPTIONS = [
  { value: 'clinic', label: '院內' },
  { value: 'owner', label: '既有飼主' },
  { value: 'new', label: '新的人' },
];

const petMode = ref('existing');
const selectedPet = ref(null);
const strayName = ref('');
const straySex = ref('unknown');
const strayColor = ref('');
const bringer = ref('clinic');
const selectedOwner = ref(null);
const ownerName = ref('');
const ownerPhone = ref('');
const reason = ref('');
const templateId = ref(props.defaultTemplateId || '');
const checkinNumber = ref(props.suggestedCheckinNumber);
const errors = ref({});
const bookedToday = computed(() => Boolean(selectedPet.value) && duplicateBookings(props.dayItems, selectedPet.value._id).some((item) => ['scheduled', 'arrived', 'pending_checkout'].includes(item.status)));
watch(bookedToday, (booked) => { errors.value = booked ? { pet: '這隻貓今天已經有掛號，請從那一筆報到' } : {}; });
const enabledTemplates = computed(() => props.templates.filter((template) => template.enabled !== false));

watch([petMode, bringer], () => { errors.value = {}; });

function validate() {
  const next = {};
  if (petMode.value === 'existing') {
    if (!selectedPet.value) next.pet = '請選擇貓咪';
    else if (bookedToday.value) next.pet = '這隻貓今天已經有掛號，請從那一筆報到';
  } else {
    if (!strayName.value.trim()) next.strayName = '請填寫名字';
    if (bringer.value === 'owner' && !selectedOwner.value) next.owner = '請選擇飼主';
    if (bringer.value === 'new') {
      if (!ownerName.value.trim()) next.ownerName = '請填寫姓名';
      const phone = checkMobilePhone(ownerPhone.value);
      if (!ownerPhone.value.trim()) next.ownerPhone = '請填寫手機';
      else if (phone.error) next.ownerPhone = phone.error;
    }
  }
  if (!templateId.value) next.template = '請選擇表單';
  errors.value = next;
  return !Object.keys(next).length;
}

function submit() {
  if (!validate()) return;
  const pet = petMode.value === 'existing'
    ? { petId: selectedPet.value._id }
    : {
        strayPet: {
          name: strayName.value.trim(),
          sex: straySex.value,
          color: strayColor.value.trim(),
          bringer: bringer.value,
          ...(bringer.value === 'owner' ? { ownerId: selectedOwner.value._id } : {}),
          ...(bringer.value === 'new' ? { ownerName: ownerName.value.trim(), ownerPhone: ownerPhone.value } : {}),
        },
      };
  emit('submit', {
    ...pet,
    reason: reason.value.trim(),
    templateId: templateId.value,
    ...(props.admit ? { admit: true } : {}),
    // 沒改建議號碼就交給伺服器配（它看得到別台剛發出去的號碼）。
    ...(props.admit || checkinNumber.value === props.suggestedCheckinNumber ? {} : { checkinNumber: checkinNumber.value }),
  });
}
</script>

<template>
  <ModalDialog size="lg" :title="admit ? '新增住院' : '現場'" :icon="Zap" @close="emit('close')">
    <template v-if="!admit" #header-end>
      <label for="walk-in-checkin-number" class="flex items-center gap-2.5 rounded-lg border border-border bg-sunken py-1 pr-1 pl-3.5">
        <span class="text-sm font-medium text-muted-foreground">號碼牌</span>
        <Input id="walk-in-checkin-number" v-model.number="checkinNumber" type="number" min="1" step="1" class="num w-16 text-center text-lg font-semibold" />
      </label>
    </template>
    <form class="flex flex-col" @submit.prevent="submit">
      <div class="space-y-4 px-6 py-5">
        <div class="flex items-center justify-between gap-3">
          <h3 class="text-base font-semibold">貓咪</h3>
          <SegmentedControl v-model="petMode" :options="PET_MODE_OPTIONS" aria-label="貓咪" />
        </div>

        <CandidateSearchField v-if="petMode === 'existing'" v-model="selectedPet" endpoint="/pets" input-id="walk-in-pet-search" placeholder="貓咪名、飼主姓名或電話" :icon="Cat" empty-text="找不到符合的貓咪；第一次來的一般病患請用掛號" :invalid="Boolean(errors.pet)">
          <template #item="{ item }">
            <span class="min-w-0 flex-1 truncate"><span class="font-semibold text-primary">{{ item.name }}</span><StrayBadge v-if="item.isStray" class="ml-2 align-middle" /><span v-if="item.breed" class="ml-2 text-xs text-muted-foreground">{{ breedText(item) }}</span><span v-if="item.ownerId?.name" class="ml-3 text-xs text-muted-foreground">{{ item.ownerId.name }}</span><span v-if="item.ownerId?.phone" class="num ml-3 text-xs text-muted-foreground">{{ item.ownerId.phone }}</span></span>
          </template>
          <template #selected="{ item }">
            <p class="truncate text-base font-bold">{{ item.name }}<span class="ml-2 text-xs font-normal">{{ breedText(item, '貓咪') }}</span></p>
            <p class="flex gap-x-3 truncate text-xs opacity-80"><span>{{ item.ownerId?.name }}</span><span v-if="item.ownerId?.phone" class="num">{{ item.ownerId.phone }}</span></p>
          </template>
        </CandidateSearchField>
        <p v-if="errors.pet" class="-mt-2 text-xs font-medium text-destructive">{{ errors.pet }}</p>

        <template v-if="petMode === 'stray'">
          <div class="grid gap-3 sm:grid-cols-3">
            <div class="space-y-1.5">
              <Label for="walk-in-stray-name" class="text-xs font-medium">名字<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
              <Input id="walk-in-stray-name" v-model="strayName" placeholder="例：咪咪" :aria-invalid="Boolean(errors.strayName)" />
              <p v-if="errors.strayName" class="text-xs font-medium text-destructive">{{ errors.strayName }}</p>
            </div>
            <div class="space-y-1.5">
              <Label class="text-xs font-medium">性別</Label>
              <SegmentedControl v-model="straySex" :options="SEX_OPTIONS" aria-label="性別" full-width />
            </div>
            <div class="space-y-1.5">
              <Label for="walk-in-stray-color" class="text-xs font-medium">花色</Label>
              <Input id="walk-in-stray-color" v-model="strayColor" placeholder="例：橘白、玳瑁" />
            </div>
          </div>

          <div class="space-y-1.5">
            <Label class="text-xs font-medium">帶貓的人</Label>
            <SegmentedControl v-model="bringer" :options="BRINGER_OPTIONS" aria-label="帶貓的人" full-width />
          </div>
          <CandidateSearchField v-if="bringer === 'owner'" v-model="selectedOwner" endpoint="/owners" input-id="walk-in-owner-search" placeholder="飼主姓名或電話" empty-text="找不到符合的飼主" :invalid="Boolean(errors.owner)">
            <template #item="{ item }">
              <span class="font-semibold text-primary">{{ item.name }}</span><span v-if="item.phone" class="num text-xs text-muted-foreground">{{ item.phone }}</span>
            </template>
            <template #selected="{ item }">
              <p class="truncate text-sm font-semibold">{{ item.name }}<span v-if="item.phone" class="num ml-2 text-xs font-normal">{{ item.phone }}</span></p>
            </template>
          </CandidateSearchField>
          <p v-if="errors.owner" class="-mt-2 text-xs font-medium text-destructive">{{ errors.owner }}</p>
          <div v-if="bringer === 'new'" class="grid gap-3 rounded-xl bg-sunken p-4 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label for="walk-in-owner-name" class="text-xs font-medium">姓名<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
              <Input id="walk-in-owner-name" v-model="ownerName" placeholder="例：王小明" :aria-invalid="Boolean(errors.ownerName)" />
              <p v-if="errors.ownerName" class="text-xs font-medium text-destructive">{{ errors.ownerName }}</p>
            </div>
            <div class="space-y-1.5">
              <Label for="walk-in-owner-phone" class="text-xs font-medium">手機<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
              <Input id="walk-in-owner-phone" v-model="ownerPhone" class="num" inputmode="tel" placeholder="例：0912-345-678" :aria-invalid="Boolean(errors.ownerPhone)" />
              <p v-if="errors.ownerPhone" class="text-xs font-medium text-destructive">{{ errors.ownerPhone }}</p>
            </div>
          </div>
        </template>

        <div class="border-t border-border pt-4">
          <h3 class="mb-3 text-base font-semibold">{{ admit ? '入院評估' : '這次看診' }}</h3>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label for="walk-in-reason" class="text-xs font-medium">{{ admit ? '住院原因' : '來院原因' }}</Label>
              <Input id="walk-in-reason" v-model="reason" placeholder="例：打疫苗、不舒服" />
            </div>
            <div class="space-y-1.5">
              <Label for="walk-in-template" class="text-xs font-medium">表單</Label>
              <Select v-model="templateId">
                <SelectTrigger id="walk-in-template" class="w-full" :aria-invalid="Boolean(errors.template)"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="template in enabledTemplates" :key="template._id" :value="template._id">{{ template.name }}</SelectItem>
                </SelectContent>
              </Select>
              <p v-if="errors.template" class="text-xs font-medium text-destructive">{{ errors.template }}</p>
            </div>
          </div>
        </div>

        <Alert v-if="errorMessage" variant="destructive">
          <AlertDescription>{{ errorMessage }}</AlertDescription>
        </Alert>
      </div>
      <DialogFooter>
        <Button type="button" variant="secondary" @click="emit('close')">取消</Button>
        <Button type="submit" :disabled="submitting">{{ submitting ? '處理中…' : admit ? '新增住院' : '報到' }}</Button>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
