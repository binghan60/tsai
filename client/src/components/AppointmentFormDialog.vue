<script setup>
import { ref, watch } from 'vue';
import { Cat, User } from '@lucide/vue';
import { http } from '../api/http';
import { clinicDateInput } from '../lib/datetime';
import ModalDialog from './ModalDialog.vue';
import PetPickerDialog from './PetPickerDialog.vue';
import { DialogDescription, DialogFooter, DialogTitle } from './ui/dialog';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { DatePicker } from './ui/date-picker';

const props = defineProps({
  open: { type: Boolean, default: false },
  defaultDate: { type: String, default: '' },
});
const emit = defineEmits(['close', 'created']);

const mode = ref('existing');
const petPickerOpen = ref(false);
const selectedPet = ref(null);
const saving = ref(false);
const error = ref('');

const form = ref({
  date: '',
  time: '',
  ownerName: '',
  ownerPhone: '',
  petName: '',
  species: '',
  reason: '',
  notes: '',
});

watch(() => props.open, (open) => {
  if (!open) return;
  mode.value = 'existing';
  selectedPet.value = null;
  error.value = '';
  form.value = {
    date: props.defaultDate || clinicDateInput(),
    time: '',
    ownerName: '',
    ownerPhone: '',
    petName: '',
    species: '',
    reason: '',
    notes: '',
  };
});

function close() {
  if (!saving.value) emit('close');
}

function selectExistingPet(pet) {
  selectedPet.value = pet;
  petPickerOpen.value = false;
}

async function submit() {
  if (saving.value) return;
  error.value = '';
  if (mode.value === 'existing' && !selectedPet.value) {
    error.value = '請先選擇寵物';
    return;
  }
  if (mode.value === 'new' && !form.value.ownerName.trim()) {
    error.value = '請填寫飼主姓名';
    return;
  }
  saving.value = true;
  try {
    const payload = {
      date: form.value.date,
      time: form.value.time,
      reason: form.value.reason,
      notes: form.value.notes,
      ...(mode.value === 'existing'
        ? { petId: selectedPet.value._id }
        : {
            ownerName: form.value.ownerName,
            ownerPhone: form.value.ownerPhone,
            petName: form.value.petName,
            species: form.value.species,
          }),
    };
    const { data } = await http.post('/appointments', payload);
    emit('created', data);
  } catch (err) {
    error.value = err.response?.data?.message ?? '新增預約失敗，請稍後再試。';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <ModalDialog v-if="open" size="md" @close="close">
    <div class="p-6 pb-3 sm:p-7 sm:pb-3">
      <DialogTitle>新增預約</DialogTitle>
      <DialogDescription class="mt-1">接電話時直接登記，稍後會出現在當天的看診列表。</DialogDescription>
    </div>

    <form class="flex flex-col" @submit.prevent="submit">
      <div class="space-y-5 px-6 pb-6 sm:px-7 sm:pb-7">
        <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>

        <div class="grid grid-cols-2 gap-2">
          <Button type="button" :variant="mode === 'existing' ? 'default' : 'outline'" @click="mode = 'existing'">
            <User class="h-4 w-4" stroke-width="1.75" />回診
          </Button>
          <Button type="button" :variant="mode === 'new' ? 'default' : 'outline'" @click="mode = 'new'">
            <Cat class="h-4 w-4" stroke-width="1.75" />初診
          </Button>
        </div>

        <div v-if="mode === 'existing'" class="space-y-2">
          <div v-if="selectedPet" class="flex items-center gap-3 rounded-xl border border-border bg-field p-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-belle-50 text-belle-600 dark:bg-brand-500/10 dark:text-brand-400">
              <Cat class="h-5 w-5" stroke-width="1.75" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-foreground">{{ selectedPet.name }}</span>
              <span class="block truncate text-xs text-muted-foreground">{{ selectedPet.ownerId?.name || '未指定飼主' }}・{{ selectedPet.ownerId?.phone || '無電話' }}</span>
            </span>
            <Button type="button" variant="outline" size="sm" @click="petPickerOpen = true">重新選擇</Button>
          </div>
          <Button v-else type="button" variant="outline" class="w-full" @click="petPickerOpen = true">選擇寵物</Button>
        </div>

        <div v-else class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for="appointment-owner-name" class="text-xs font-medium text-foreground">飼主姓名 <span class="text-belle-600 dark:text-brand-400">*</span></Label>
            <Input id="appointment-owner-name" v-model="form.ownerName" placeholder="王小明" />
          </div>
          <div class="space-y-1.5">
            <Label for="appointment-owner-phone" class="text-xs font-medium text-foreground">聯絡電話</Label>
            <Input id="appointment-owner-phone" v-model="form.ownerPhone" placeholder="0912-345-678" />
          </div>
          <div class="space-y-1.5">
            <Label for="appointment-pet-name" class="text-xs font-medium text-foreground">寵物名稱</Label>
            <Input id="appointment-pet-name" v-model="form.petName" placeholder="到診再補也可以" />
          </div>
          <div class="space-y-1.5">
            <Label for="appointment-species" class="text-xs font-medium text-foreground">物種</Label>
            <Input id="appointment-species" v-model="form.species" placeholder="貓／狗" />
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label class="text-xs font-medium text-foreground">預約日期 <span class="text-belle-600 dark:text-brand-400">*</span></Label>
            <DatePicker v-model="form.date" aria-label="預約日期" />
          </div>
          <div class="space-y-1.5">
            <Label for="appointment-time" class="text-xs font-medium text-foreground">預約時間</Label>
            <Input id="appointment-time" v-model="form.time" type="time" />
          </div>
        </div>
        <div class="space-y-1.5">
          <Label for="appointment-reason" class="text-xs font-medium text-foreground">看診原因</Label>
          <Input id="appointment-reason" v-model="form.reason" placeholder="主訴或掛號原因" />
        </div>
        <div class="space-y-1.5">
          <Label for="appointment-notes" class="text-xs font-medium text-foreground">備註</Label>
          <Textarea id="appointment-notes" v-model="form.notes" rows="2" />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" class="px-5 border-border hover:bg-muted/60" :disabled="saving" @click="close">取消</Button>
        <Button type="submit" class="px-5" :disabled="saving">{{ saving ? '建立中…' : '建立預約' }}</Button>
      </DialogFooter>
    </form>

    <PetPickerDialog :open="petPickerOpen" @close="petPickerOpen = false" @select="selectExistingPet" />
  </ModalDialog>
</template>
