<script setup>
import { apiErrorMessage } from '../lib/apiError.js';
import { computed, ref } from 'vue';
import { Check, X } from '@lucide/vue';
import { http } from '../api/http';
import { INTAKE_FOOD_OPTIONS, INTAKE_HISTORY_OPTIONS } from '../lib/intakeDisplay';
import BreedSelect from './BreedSelect.vue';
import SegmentedControl from './SegmentedControl.vue';
import YearMonthSelect from './YearMonthSelect.vue';
import { checkMobilePhone } from '../../../shared/phone.js';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { DatePicker } from './ui/date-picker';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { INTAKE_HISTORY_NONE, toggleMedicalHistory } from '../../../shared/intakeRequired.js';

// 初診表審核時就地修改一段（貓咪／醫療紀錄／飼主），存檔寫回這份初診表（PUT /intake-submissions/:id），
// 掛號時才用改過的內容建立正式資料。選項與公開初診頁同一份（lib/intakeDisplay.js）。
const props = defineProps({
  section: { type: String, required: true },
  submission: { type: Object, required: true },
});
const emit = defineEmits(['saved', 'cancel']);

const SEX = [{ value: 'unknown', label: '未填' }, { value: 'male', label: '公' }, { value: 'female', label: '母' }];
const NEUTERED = [{ value: 'unknown', label: '未填' }, { value: 'yes', label: '已結紮' }, { value: 'no', label: '未結紮' }];
const FEEDING = [{ value: 'unknown', label: '未填' }, { value: 'free', label: '任食' }, { value: 'scheduled', label: '定食定量' }];
const VACCINE = [{ value: 'unknown', label: '未填' }, { value: 'none', label: '未注射' }, { value: 'done', label: '已注射' }];
const ALLERGY = [{ value: 'unknown', label: '未填' }, { value: 'none', label: '無過敏' }, { value: 'yes', label: '有' }];
const CHECKUP = [{ value: 'unknown', label: '未填' }, { value: 'none', label: '未健檢' }, { value: 'done', label: '有' }];

const source = props.submission;
const owner = ref({ ...source.owner });
const pet = ref({
  ...source.pet,
  foods: [...(source.pet.foods || [])],
  medicalHistory: [...(source.pet.medicalHistory || [])],
  birthDate: source.pet.birthDate ? String(source.pet.birthDate).slice(0, 10) : '',
  householdCatCount: source.pet.householdCatCount ?? '',
  mealsPerDay: source.pet.mealsPerDay ?? '',
});
const saving = ref(false);
const error = ref('');
const attempted = ref(false);

const required = computed(() => ({
  petName: props.section === 'pet' && !String(pet.value.name || '').trim() ? '請填寫貓咪名字' : '',
  ownerName: props.section === 'owner' && !String(owner.value.name || '').trim() ? '請填寫飼主姓名' : '',
  ownerPhone: props.section !== 'owner' ? ''
    : !String(owner.value.phone || '').trim() ? '請填寫手機'
      : checkMobilePhone(owner.value.phone, props.submission?.owner?.phone).error,
}));

function toggle(list, option, checked) {
  const next = new Set(list);
  if (checked) next.add(option);
  else next.delete(option);
  return [...next];
}

// 「無」跟其他病史互斥；勾「無」連其他病史的文字一起清掉。
function pickHistory(option, checked) {
  pet.value.medicalHistory = toggleMedicalHistory(pet.value.medicalHistory, option, checked);
  if (checked && option === INTAKE_HISTORY_NONE) pet.value.medicalHistoryOther = '';
}

function payload() {
  const p = pet.value;
  if (props.section === 'owner') return { owner: { ...owner.value } };
  if (props.section === 'medical') {
    return { pet: { vaccineStatus: p.vaccineStatus, vaccineDate: p.vaccineDate, medicalHistory: p.medicalHistory, medicalHistoryOther: p.medicalHistoryOther, allergyStatus: p.allergyStatus, allergyType: p.allergyType, checkupStatus: p.checkupStatus, checkupDate: p.checkupDate } };
  }
  return { pet: { name: p.name, sex: p.sex, neutered: p.neutered, birthDate: p.birthDate || null, birthDateEstimated: p.birthDateEstimated, breed: p.breed, color: p.color, householdCatCount: p.householdCatCount, foods: p.foods, foodsOther: p.foodsOther, feedingType: p.feedingType, mealsPerDay: p.mealsPerDay } };
}

async function save() {
  attempted.value = true;
  if (Object.values(required.value).some(Boolean) || saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    const { data } = await http.put(`/intake-submissions/${source._id}`, { version: source.__v ?? 0, ...payload() });
    emit('saved', data);
  } catch (err) {
    error.value = apiErrorMessage(err, '儲存失敗，請稍後再試');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form class="space-y-4 rounded-xl border border-border-strong bg-card p-4" @submit.prevent="save">
    <div class="grid gap-4 @lg:grid-cols-2">
      <template v-if="section === 'pet'">
        <div class="space-y-1.5">
          <Label for="intake-edit-pet-name">名字<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
          <Input id="intake-edit-pet-name" v-model="pet.name" :aria-invalid="attempted && Boolean(required.petName)" />
          <p v-if="attempted && required.petName" class="text-xs font-medium text-destructive">{{ required.petName }}</p>
        </div>
        <div class="space-y-1.5"><Label for="intake-edit-birth">出生日期</Label><DatePicker id="intake-edit-birth" v-model="pet.birthDate" aria-label="出生日期" @update:model-value="pet.birthDateEstimated = false" /></div>
        <div class="space-y-1.5"><Label>性別</Label><SegmentedControl v-model="pet.sex" :options="SEX" aria-label="性別" size="sm" full-width /></div>
        <div class="space-y-1.5"><Label>結紮</Label><SegmentedControl v-model="pet.neutered" :options="NEUTERED" aria-label="結紮" size="sm" full-width /></div>
        <div class="space-y-1.5"><Label for="intake-edit-breed">品種</Label><BreedSelect id="intake-edit-breed" v-model="pet.breed" /></div>
        <div class="space-y-1.5"><Label for="intake-edit-color">花色</Label><Input id="intake-edit-color" v-model="pet.color" /></div>
        <div class="space-y-1.5"><Label for="intake-edit-household">家中貓口（隻）</Label><Input id="intake-edit-household" v-model="pet.householdCatCount" class="num" type="number" min="0" max="99" step="1" inputmode="numeric" /></div>
        <div class="space-y-1.5 @lg:col-span-2">
          <Label>主餐配菜</Label>
          <div class="flex flex-wrap gap-x-4 gap-y-2">
            <label v-for="option in INTAKE_FOOD_OPTIONS" :key="option" class="flex items-center gap-2 text-sm"><Checkbox :model-value="pet.foods.includes(option)" @update:model-value="pet.foods = toggle(pet.foods, option, $event === true)" />{{ option }}</label>
          </div>
          <Input v-if="pet.foods.includes('其他')" v-model="pet.foodsOther" aria-label="其他主餐配菜" placeholder="其他主餐配菜" />
        </div>
        <div class="space-y-1.5 @lg:col-span-2">
          <Label>放飯頻率</Label>
          <div class="flex flex-wrap items-center gap-3">
            <SegmentedControl v-model="pet.feedingType" :options="FEEDING" aria-label="放飯頻率" size="sm" />
            <label v-if="pet.feedingType === 'scheduled'" class="flex items-center gap-2 text-sm">一日<Input v-model="pet.mealsPerDay" class="num w-20" type="number" min="1" max="20" step="1" inputmode="numeric" aria-label="一日餐數" />餐</label>
          </div>
        </div>
      </template>

      <template v-else-if="section === 'medical'">
        <div class="space-y-1.5 @lg:col-span-2">
          <Label>疫苗</Label>
          <div class="flex flex-wrap items-center gap-3">
            <SegmentedControl v-model="pet.vaccineStatus" :options="VACCINE" aria-label="疫苗" size="sm" />
            <YearMonthSelect v-if="pet.vaccineStatus === 'done'" v-model="pet.vaccineDate" label="最後注射時間" />
          </div>
        </div>
        <div class="space-y-1.5 @lg:col-span-2">
          <Label>病史</Label>
          <div class="flex flex-wrap gap-x-4 gap-y-2">
            <label v-for="option in INTAKE_HISTORY_OPTIONS" :key="option" class="flex items-center gap-2 text-sm"><Checkbox :model-value="pet.medicalHistory.includes(option)" @update:model-value="pickHistory(option, $event === true)" />{{ option }}</label>
          </div>
          <Input v-model="pet.medicalHistoryOther" aria-label="其他病史" placeholder="其他病史" />
        </div>
        <div class="space-y-1.5 @lg:col-span-2">
          <Label>藥物過敏</Label>
          <div class="flex flex-wrap items-center gap-3">
            <SegmentedControl v-model="pet.allergyStatus" :options="ALLERGY" aria-label="藥物過敏" size="sm" />
            <Input v-if="pet.allergyStatus === 'yes'" v-model="pet.allergyType" class="min-w-44 flex-1" aria-label="過敏藥物" placeholder="過敏藥物" />
          </div>
        </div>
        <div class="space-y-1.5 @lg:col-span-2">
          <Label>健檢</Label>
          <div class="flex flex-wrap items-center gap-3">
            <SegmentedControl v-model="pet.checkupStatus" :options="CHECKUP" aria-label="健檢" size="sm" />
            <YearMonthSelect v-if="pet.checkupStatus === 'done'" v-model="pet.checkupDate" label="上次健檢時間" />
          </div>
        </div>
      </template>

      <template v-else>
        <div class="space-y-1.5">
          <Label for="intake-edit-owner-name">姓名<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
          <Input id="intake-edit-owner-name" v-model="owner.name" :aria-invalid="attempted && Boolean(required.ownerName)" />
          <p v-if="attempted && required.ownerName" class="text-xs font-medium text-destructive">{{ required.ownerName }}</p>
        </div>
        <div class="space-y-1.5">
          <Label for="intake-edit-owner-phone">手機<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
          <Input id="intake-edit-owner-phone" v-model="owner.phone" class="num" inputmode="tel" :aria-invalid="attempted && Boolean(required.ownerPhone)" />
          <p v-if="attempted && required.ownerPhone" class="text-xs font-medium text-destructive">{{ required.ownerPhone }}</p>
        </div>
        <div class="space-y-1.5"><Label for="intake-edit-owner-landline">市話</Label><Input id="intake-edit-owner-landline" v-model="owner.landline" class="num" inputmode="tel" /></div>
        <div class="space-y-1.5"><Label for="intake-edit-owner-email">Email</Label><Input id="intake-edit-owner-email" v-model="owner.email" type="email" /></div>
        <div class="space-y-1.5 @lg:col-span-2"><Label for="intake-edit-owner-address">地址</Label><Input id="intake-edit-owner-address" v-model="owner.address" /></div>
      </template>
    </div>

    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <div class="flex justify-end gap-2">
      <Button type="button" variant="secondary" size="sm" :disabled="saving" @click="emit('cancel')"><X stroke-width="1.75" />取消</Button>
      <Button type="submit" size="sm" :disabled="saving"><Check stroke-width="1.75" />{{ saving ? '儲存中…' : '儲存' }}</Button>
    </div>
  </form>
</template>
