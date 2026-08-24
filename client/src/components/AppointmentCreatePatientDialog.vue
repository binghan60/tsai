<script setup>
import { ref, watch } from 'vue';
import { http } from '../api/http';
import ModalDialog from './ModalDialog.vue';
import { DialogDescription, DialogFooter, DialogTitle } from './ui/dialog';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

const props = defineProps({
  appointment: { type: Object, default: null },
});
const emit = defineEmits(['close', 'created']);

const petName = ref('');
const species = ref('');
const saving = ref(false);
const error = ref('');

watch(() => props.appointment, (appointment) => {
  if (!appointment) return;
  petName.value = appointment.petName || '';
  species.value = appointment.species || '';
  error.value = '';
});

function close() {
  if (!saving.value) emit('close');
}

async function submit() {
  if (saving.value || !props.appointment) return;
  if (!petName.value.trim()) {
    error.value = '請填寫寵物名稱';
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    const { data } = await http.post(`/appointments/${props.appointment._id}/create-patient`, {
      petName: petName.value,
      species: species.value,
    });
    emit('created', data);
  } catch (err) {
    error.value = err.response?.data?.message ?? '建立病患檔案失敗，請稍後再試。';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <ModalDialog v-if="appointment" size="sm" @close="close">
    <div class="p-6 pb-3 sm:p-7 sm:pb-3">
      <DialogTitle>建立病患檔案</DialogTitle>
      <DialogDescription class="mt-1">初診預約補上寵物名稱後，就會建立飼主與寵物資料並進入健檢報告。</DialogDescription>
    </div>

    <form class="flex flex-col" @submit.prevent="submit">
      <div class="space-y-4 px-6 pb-6 sm:px-7 sm:pb-7">
        <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
        <div class="space-y-1.5">
          <Label for="create-patient-pet-name" class="text-xs font-medium text-foreground">寵物名稱 <span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
          <Input id="create-patient-pet-name" v-model="petName" autofocus placeholder="小白" />
        </div>
        <div class="space-y-1.5">
          <Label for="create-patient-species" class="text-xs font-medium text-foreground">物種</Label>
          <Input id="create-patient-species" v-model="species" placeholder="貓／狗" />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" class="px-5 border-border hover:bg-muted/60" :disabled="saving" @click="close">取消</Button>
        <Button type="submit" class="px-5" :disabled="saving">{{ saving ? '建立中…' : '建立並開始健檢' }}</Button>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
