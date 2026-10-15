<script setup>
import { ref } from 'vue';
import { ArrowLeftRight } from '@lucide/vue';
import ModalDialog from './ModalDialog.vue';
import SegmentedControl from './SegmentedControl.vue';
import CandidateSearchField from './CandidateSearchField.vue';
import SpecGrid from './SpecGrid.vue';
import SpecCell from './SpecCell.vue';
import { DialogFooter } from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Alert, AlertDescription } from './ui/alert';
import { http } from '../api/http';
import { apiErrorMessage } from '../lib/apiError';
import { useToast } from '../composables/useToast';
import { checkMobilePhone } from '../../../shared/phone.js';

// 換飼主（流浪貓被認養、愛媽轉給別人）：POST /pets/:id/transfer-owner。
// 還沒報到的掛號跟著換；已經發生的看診、報告、藥單留著當時的飼主名字。
const props = defineProps({
  pet: { type: Object, required: true },
});
const emit = defineEmits(['transferred', 'close']);
const toast = useToast();

const OWNER_MODE_OPTIONS = [
  { value: 'existing', label: '既有飼主' },
  { value: 'new', label: '新飼主' },
];
const ownerMode = ref('existing');
const selectedOwner = ref(null);
const ownerName = ref('');
const ownerPhone = ref('');
// 從院內換出去＝被認養，預設拿掉流浪貓標記；愛媽轉給別人的不一定，預設留著。
const clearStray = ref(props.pet.ownerId?.kind === 'clinic');
const errors = ref({});
const errorMessage = ref('');
const submitting = ref(false);

function validate() {
  const next = {};
  if (ownerMode.value === 'existing') {
    if (!selectedOwner.value) next.owner = '請選擇飼主';
    else if (String(selectedOwner.value._id) === String(props.pet.ownerId?._id)) next.owner = '新飼主跟目前的飼主是同一位';
  } else {
    if (!ownerName.value.trim()) next.ownerName = '請填寫姓名';
    const phone = checkMobilePhone(ownerPhone.value);
    if (!ownerPhone.value.trim()) next.ownerPhone = '請填寫手機';
    else if (phone.error) next.ownerPhone = phone.error;
  }
  errors.value = next;
  return !Object.keys(next).length;
}

async function submit() {
  if (submitting.value || !validate()) return;
  submitting.value = true;
  errorMessage.value = '';
  try {
    const target = ownerMode.value === 'existing'
      ? { ownerId: selectedOwner.value._id }
      : { owner: { name: ownerName.value.trim(), phone: ownerPhone.value } };
    await http.post(`/pets/${props.pet._id}/transfer-owner`, {
      ...target,
      clearStray: props.pet.isStray && clearStray.value,
      expectedVersion: props.pet.__v,
    });
    const name = ownerMode.value === 'existing' ? selectedOwner.value.name : ownerName.value.trim();
    toast.success(`${props.pet.name}的飼主已換成${name}`, '已換飼主');
    emit('transferred');
  } catch (err) {
    errorMessage.value = apiErrorMessage(err, '換飼主失敗，請稍後重試');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <ModalDialog size="md" :title="`換飼主：${pet.name}`" :icon="ArrowLeftRight" @close="emit('close')">
    <form class="flex flex-col" @submit.prevent="submit">
      <div class="space-y-5 px-6 py-5">
        <SpecGrid>
          <SpecCell label="目前">{{ pet.ownerId?.name }}</SpecCell>
        </SpecGrid>

        <div class="space-y-2">
          <Label class="text-xs font-medium">新飼主</Label>
          <SegmentedControl v-model="ownerMode" :options="OWNER_MODE_OPTIONS" aria-label="新飼主" />
          <template v-if="ownerMode === 'existing'">
            <CandidateSearchField v-model="selectedOwner" endpoint="/owners" input-id="transfer-owner-search" empty-text="找不到符合的飼主" :invalid="Boolean(errors.owner)">
              <template #item="{ item }">
                <span class="font-semibold text-primary">{{ item.name }}</span><span v-if="item.phone" class="num text-xs text-muted-foreground">{{ item.phone }}</span>
              </template>
              <template #selected="{ item }">
                <p class="truncate text-sm font-semibold">{{ item.name }}<span v-if="item.phone" class="num ml-2 text-xs font-normal">{{ item.phone }}</span></p>
              </template>
            </CandidateSearchField>
            <p v-if="errors.owner" class="text-xs font-medium text-destructive">{{ errors.owner }}</p>
          </template>
          <div v-else class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label for="transfer-owner-name" class="text-xs font-medium">姓名<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
              <Input id="transfer-owner-name" v-model="ownerName" :aria-invalid="Boolean(errors.ownerName)" />
              <p v-if="errors.ownerName" class="text-xs font-medium text-destructive">{{ errors.ownerName }}</p>
            </div>
            <div class="space-y-1.5">
              <Label for="transfer-owner-phone" class="text-xs font-medium">手機<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
              <Input id="transfer-owner-phone" v-model="ownerPhone" class="num" inputmode="tel" :aria-invalid="Boolean(errors.ownerPhone)" />
              <p v-if="errors.ownerPhone" class="text-xs font-medium text-destructive">{{ errors.ownerPhone }}</p>
            </div>
          </div>
        </div>

        <label v-if="pet.isStray" class="flex items-center gap-2.5 rounded-lg bg-sunken px-3.5 py-3 text-sm font-medium"><Checkbox v-model="clearStray" />拿掉「流浪貓」標記</label>

        <Alert v-if="errorMessage" variant="destructive">
          <AlertDescription>{{ errorMessage }}</AlertDescription>
        </Alert>
      </div>
      <DialogFooter>
        <Button type="button" variant="secondary" @click="emit('close')">取消</Button>
        <Button type="submit" :disabled="submitting">{{ submitting ? '處理中…' : '確定換飼主' }}</Button>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
