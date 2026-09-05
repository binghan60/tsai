<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import {
  AlertCircle,
  Calculator,
  Cat,
  Check,
  CheckCircle2,
  Clock,
  HeartPulse,
  Mail,
  MapPin,
  PawPrint,
  RefreshCw,
  Search,
  Sparkles,
  User,
  X,
} from '@lucide/vue';
import { http } from '../api/http';
import Breadcrumbs from '../components/Breadcrumbs.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { Card } from '../components/ui/card';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { DatePicker } from '../components/ui/date-picker';
import { Textarea } from '../components/ui/textarea';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription } from '../components/ui/alert';
import SegmentedControl from '../components/SegmentedControl.vue';
import PickerOptionRow from '../components/PickerOptionRow.vue';
import ListSkeleton from '../components/ListSkeleton.vue';
import { emptyOwnerDraft, emptyPetDraft } from '../lib/formDrafts';
import { useToast } from '../composables/useToast';

const router = useRouter();
const route = useRoute();
const toast = useToast();

// ----------------------------------------------------
// 飼主管理模組 (Owner Module)
// ----------------------------------------------------
const ownerMode = ref('new');
const OWNER_MODE_OPTIONS = [
  { value: 'new', label: '建立新飼主' },
  { value: 'existing', label: '選擇既有飼主' },
];

const ownerQuery = ref('');
const owners = ref([]);
const ownerPage = ref(1);
const ownerTotal = ref(0);
const ownerLimit = ref(12);
const ownerLoading = ref(false);
const ownerListError = ref('');
const selectedOwner = ref(null);
let ownerRequestSeq = 0;
let ownerSearchTimer;

const hasMoreOwners = computed(() => owners.value.length < ownerTotal.value);

async function fetchOwners({ append = false } = {}) {
  const keyword = ownerQuery.value.trim();
  const current = ++ownerRequestSeq;
  if (!keyword) {
    owners.value = [];
    ownerPage.value = 1;
    ownerTotal.value = 0;
    ownerLoading.value = false;
    ownerListError.value = '';
    return;
  }

  const nextPage = append ? ownerPage.value + 1 : 1;
  ownerLoading.value = true;
  ownerListError.value = '';
  try {
    const { data } = await http.get('/owners', {
      params: { page: nextPage, limit: ownerLimit.value, q: keyword },
    });
    if (current !== ownerRequestSeq) return;
    const items = data.items ?? [];
    owners.value = append ? [...owners.value, ...items] : items;
    ownerPage.value = nextPage;
    ownerTotal.value = data.total ?? owners.value.length;
    ownerLimit.value = data.limit ?? ownerLimit.value;
  } catch (err) {
    if (current === ownerRequestSeq) ownerListError.value = '飼主搜尋失敗，請稍後再試。';
  } finally {
    if (current === ownerRequestSeq) ownerLoading.value = false;
  }
}

watch(ownerQuery, () => {
  clearTimeout(ownerSearchTimer);
  if (!ownerQuery.value.trim()) {
    fetchOwners();
    return;
  }
  ownerSearchTimer = setTimeout(fetchOwners, 250);
});

function loadMoreOwners() {
  if (!ownerLoading.value && hasMoreOwners.value) fetchOwners({ append: true });
}

function selectOwner(owner) {
  selectedOwner.value = owner;
  errors.owner = '';
}

function clearSelectedOwner() {
  selectedOwner.value = null;
  ownerQuery.value = '';
  fetchOwners();
}

function switchModeToNewWithQuery() {
  const q = ownerQuery.value.trim();
  ownerMode.value = 'new';
  if (/^09\d{2}-?\d{3}-?\d{3}$|^\d{7,10}$/.test(q)) {
    newOwner.value.phone = q;
  } else if (q) {
    newOwner.value.name = q;
  }
}

const newOwner = ref(emptyOwnerDraft());
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const activeOwnerName = computed(() => ownerMode.value === 'existing'
  ? selectedOwner.value?.name ?? ''
  : newOwner.value.name.trim());

watch(ownerMode, (mode) => {
  errors.owner = '';
  if (mode === 'new') selectedOwner.value = null;
});

// ----------------------------------------------------
// 寵物表單模組 (Pet Form Module) - 貓咪專科專屬
// ----------------------------------------------------
const petForm = ref({
  ...emptyPetDraft(),
  species: '貓',
});

// 常見貓咪品種推薦標籤（點擊一鍵填入）
const CAT_BREED_RECOMMENDATIONS = [
  '米克斯', '英國短毛貓', '美國短毛貓', '布偶貓', '曼赤肯', '波斯貓',
  '緬因貓', '金吉拉', '暹羅貓', '俄羅斯藍貓', '阿比西尼亞貓', '無毛貓',
];

function applyBreed(breed) {
  petForm.value.breed = breed;
}

// 性別與絕育
const SEX_OPTIONS = [
  { value: 'unknown', label: '未記錄' },
  { value: 'male', label: '♂ 公' },
  { value: 'female', label: '♀ 母' },
];

const NEUTERED_OPTIONS = [
  { value: 'unknown', label: '未記錄' },
  { value: 'yes', label: '已絕育' },
  { value: 'no', label: '未絕育' },
];

// ----------------------------------------------------
// 生日與即時年齡換算器 (Age & Birthday Calculation)
// 這頁走「一次攤平」——年齡推算器不再是展開/收合的面板，永遠顯示在生日欄位旁邊，
// 開合動畫改變版面高度那種跳動感，就是這頁要避免的。
// ----------------------------------------------------
const calcYears = ref(1);
const calcMonths = ref(0);

const computedAgeText = computed(() => {
  if (!petForm.value.birthDate) return '';
  const birth = new Date(petForm.value.birthDate);
  if (Number.isNaN(birth.getTime())) return '';

  const now = new Date();
  if (birth > now) return '尚未出生 / 未來日期';

  let years = now.getFullYear() - birth.getFullYear();
  let months = now.getMonth() - birth.getMonth();
  if (now.getDate() < birth.getDate()) {
    months -= 1;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  if (years === 0 && months === 0) {
    const diffDays = Math.floor((now - birth) / (1000 * 60 * 60 * 24));
    return diffDays <= 7 ? '新生幼寵' : `約 ${Math.max(Math.floor(diffDays / 7), 1)} 週大`;
  }
  if (years === 0) {
    return `約 ${months} 個月大`;
  }
  return months > 0 ? `現年 ${years} 歲 ${months} 個月` : `現年 ${years} 歲整`;
});

function applyAgeCalculation() {
  const y = Math.max(Number(calcYears.value) || 0, 0);
  const m = Math.max(Number(calcMonths.value) || 0, 0);
  if (y === 0 && m === 0) {
    toast.error('請輸入有效的年數或月數');
    return;
  }

  const date = new Date();
  date.setFullYear(date.getFullYear() - y);
  date.setMonth(date.getMonth() - m);
  date.setDate(1); // 設為該月 1 號

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  petForm.value.birthDate = `${yyyy}-${mm}-${dd}`;
  petForm.value.birthDateEstimated = true;
  toast.success(`已依概略年齡填入預估生日：${petForm.value.birthDate}`, '年齡推算完成');
}

// ----------------------------------------------------
// 醫療病史（選填，永遠攤開——理由同上，這頁不做收合展開）
// ----------------------------------------------------
const filledMedicalCount = computed(() => {
  let count = 0;
  if (petForm.value.allergies?.trim()) count++;
  if (petForm.value.chronicConditions?.trim()) count++;
  if (petForm.value.currentMedications?.trim()) count++;
  if (petForm.value.notes?.trim()) count++;
  return count;
});

// ----------------------------------------------------
// 行內表單驗證 (Inline Validation & Smart Focus)
// ----------------------------------------------------
const errors = reactive({
  owner: '',
  newOwnerName: '',
  newOwnerPhone: '',
  newOwnerEmail: '',
  petName: '',
  species: '',
});

function validateForm() {
  let valid = true;
  errors.owner = '';
  errors.newOwnerName = '';
  errors.newOwnerPhone = '';
  errors.newOwnerEmail = '';
  errors.petName = '';
  errors.species = '';

  let firstErrorId = null;

  if (ownerMode.value === 'existing') {
    if (!selectedOwner.value) {
      errors.owner = '請搜尋並選擇一位飼主';
      valid = false;
      firstErrorId = firstErrorId || 'owner-search-input';
    }
  } else {
    if (!newOwner.value.name.trim()) {
      errors.newOwnerName = '請填寫飼主姓名';
      valid = false;
      firstErrorId = firstErrorId || 'new-owner-name';
    }
    if (!newOwner.value.phone.trim()) {
      errors.newOwnerPhone = '請填寫聯絡電話';
      valid = false;
      firstErrorId = firstErrorId || 'new-owner-phone';
    }
    if (newOwner.value.email.trim() && !EMAIL_PATTERN.test(newOwner.value.email.trim())) {
      errors.newOwnerEmail = 'Email 格式不正確';
      valid = false;
      firstErrorId = firstErrorId || 'new-owner-email';
    }
  }

  if (!petForm.value.name.trim()) {
    errors.petName = '請填寫寵物名字';
    valid = false;
    firstErrorId = firstErrorId || 'new-pet-name';
  }

  if (!valid && firstErrorId) {
    nextTick(() => {
      const el = document.getElementById(firstErrorId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
      }
    });
  }

  return valid;
}

// ----------------------------------------------------
// 提交與離開防護 (Submit & Navigation Guard)
// ----------------------------------------------------
const submitting = ref(false);
const submitError = ref('');
const leavingAfterAction = ref(false);
const pendingLeavePath = ref('');

const isDirty = computed(() => {
  if (selectedOwner.value) return true;
  if (Object.values(newOwner.value).some((v) => String(v ?? '').trim())) return true;
  return Object.entries(petForm.value).some(([key, value]) => {
    if (key === 'sex' || key === 'neutered') return false;
    if (key === 'species' && value === '貓') return false;
    return String(value ?? '').trim();
  });
});

async function submit() {
  submitError.value = '';
  if (!validateForm()) {
    submitError.value = '部分必填欄位尚未填寫或格式有誤，請檢查標記欄位。';
    return;
  }

  submitting.value = true;
  try {
    const payload = {
      ...petForm.value,
      birthDate: petForm.value.birthDate || null,
      weightKg: petForm.value.weightKg === '' || petForm.value.weightKg == null ? null : Number(petForm.value.weightKg),
    };

    const { data: pet } = ownerMode.value === 'existing'
      ? await http.post(`/owners/${selectedOwner.value._id}/pets`, payload)
      : await http.post('/owners/with-pet', { owner: newOwner.value, pet: payload });
    toast.success(`已成功為 ${activeOwnerName.value} 新增「${pet.name}」`, '新增寵物成功');
    leavingAfterAction.value = true;
    await router.push(`/pets/${pet._id}`);
  } catch (err) {
    submitError.value = err.response?.data?.message ?? '新增寵物失敗，請稍後再試。';
  } finally {
    submitting.value = false;
  }
}

function cancel() {
  router.push('/pets');
}

onBeforeRouteLeave((to) => {
  if (leavingAfterAction.value || !isDirty.value) return true;
  pendingLeavePath.value = to.fullPath;
  return false;
});

async function confirmLeave() {
  if (!pendingLeavePath.value) return;
  leavingAfterAction.value = true;
  await router.push(pendingLeavePath.value);
}

function handleBeforeUnload(event) {
  if (!isDirty.value) return;
  event.preventDefault();
  event.returnValue = '';
}

onMounted(async () => {
  window.addEventListener('beforeunload', handleBeforeUnload);

  // 支援 URL Query ?ownerId=... 自動鎖定飼主
  const queryOwnerId = route.query.ownerId;
  if (queryOwnerId) {
    try {
      ownerLoading.value = true;
      const { data } = await http.get(`/owners/${queryOwnerId}`);
      if (data) {
        selectedOwner.value = data;
        ownerMode.value = 'existing';
        toast.info(`已為您自動帶入飼主「${data.name}」`, '已載入指定飼主');
      }
    } catch {
      // 找不到就照常載入清單
      fetchOwners();
    } finally {
      ownerLoading.value = false;
    }
  } else {
    fetchOwners();
  }
});

onBeforeUnmount(() => {
  clearTimeout(ownerSearchTimer);
  window.removeEventListener('beforeunload', handleBeforeUnload);
});
</script>

<template>
  <section class="relative mx-auto max-w-5xl space-y-5 pb-28">
    <!-- 頂部導航 -->
    <Breadcrumbs :items="[{ label: '寵物列表', to: '/pets' }, { label: '新增貓咪檔案' }]" />

    <!-- 頁面標題列 -->
    <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div>
        <h1 class="flex items-center gap-2 text-xl font-semibold text-foreground">
          <PawPrint class="h-5 w-5 text-primary" />
          新增貓咪檔案
        </h1>
        <p class="mt-1 text-sm text-muted-foreground">確認飼主身分、填寫貓咪基本資料與病史，一次送出建立檔案。</p>
      </div>
      <Button type="button" variant="outline" size="sm" class="self-start sm:self-auto" :disabled="submitting" @click="cancel">取消返回</Button>
    </div>

    <Alert v-if="submitError" variant="destructive">
      <AlertCircle class="h-4 w-4" />
      <AlertDescription>{{ submitError }}</AlertDescription>
    </Alert>

    <!-- 單一平面表單：飼主／貓咪資料／病史都在同一張卡片裡，用細分隔線分區，
         不做任何收合展開——這頁原本用「步驟一/二/三」的卡片各自攤開，
         但三張卡同時全部可見時「步驟」這個詞本身就名不符實；折成手風琴
         又會在切換時讓版面高度跳動。改成一張平面表單，卡片邊界、圖示方塊、
         每步驟自己的說明文字這些重複的裝飾都拿掉，靠留白與細分隔線分區。 -->
    <Card class="space-y-6 p-5 shadow-sm sm:p-6">
      <!-- 飼主 -->
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <User class="h-4 w-4 text-primary" stroke-width="2" />
            <h2 class="text-xs font-semibold tracking-wide text-foreground uppercase">飼主</h2>
          </div>
          <Badge v-if="selectedOwner && ownerMode === 'existing'" variant="secondary" class="gap-1 border-success/30 bg-success-surface text-xs text-success">
            <CheckCircle2 class="h-3.5 w-3.5" />
            已確認飼主
          </Badge>
        </div>

        <SegmentedControl v-model="ownerMode" :options="OWNER_MODE_OPTIONS" aria-label="飼主來源" full-width />

        <!-- 模式 1：選擇既有飼主 -->
        <template v-if="ownerMode === 'existing'">
          <div v-if="selectedOwner" class="rounded-xl border border-primary/25 bg-accent/40 p-4">
            <div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div class="flex items-center gap-3.5">
                <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground shadow-xs">
                  {{ selectedOwner.name?.[0] ?? '?' }}
                </div>
                <div class="space-y-0.5">
                  <div class="flex items-center gap-2">
                    <span class="text-base font-semibold text-foreground">{{ selectedOwner.name }}</span>
                    <Badge variant="outline" class="px-1.5 py-0 text-xs font-normal">已登記飼主</Badge>
                  </div>
                  <div class="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5 text-xs text-muted-foreground">
                    <span>{{ selectedOwner.phone || '無電話紀錄' }}</span>
                    <span v-if="selectedOwner.email" class="flex items-center gap-1"><Mail class="h-3 w-3" />{{ selectedOwner.email }}</span>
                    <span v-if="selectedOwner.address" class="flex items-center gap-1"><MapPin class="h-3 w-3" />{{ selectedOwner.address }}</span>
                  </div>
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" class="h-8 shrink-0 gap-1.5 self-start text-xs sm:self-center" @click="clearSelectedOwner">
                <RefreshCw class="h-3.5 w-3.5" />
                更換飼主
              </Button>
            </div>
          </div>

          <div v-else class="space-y-3">
            <div class="relative">
              <Search class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="owner-search-input"
                v-model="ownerQuery"
                type="text"
                class="h-10 pl-10 pr-8 text-sm"
                :class="{ 'border-destructive focus-visible:ring-destructive': errors.owner }"
                placeholder="請輸入飼主姓名或手機電話進行搜尋…"
                aria-label="搜尋飼主"
                autofocus
              />
              <button v-if="ownerQuery" type="button" class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" @click="ownerQuery = ''">
                <X class="h-4 w-4" />
              </button>
            </div>

            <p v-if="errors.owner" class="flex items-center gap-1 text-xs text-destructive">
              <AlertCircle class="h-3.5 w-3.5" />
              {{ errors.owner }}
            </p>

            <ListSkeleton v-if="ownerLoading" inset :rows="2" />
            <Alert v-else-if="ownerListError" variant="destructive" class="py-2"><AlertDescription class="text-xs">{{ ownerListError }}</AlertDescription></Alert>

            <div v-else-if="owners.length" class="space-y-2">
              <div class="flex items-center justify-between px-0.5 text-xs text-muted-foreground">
                <span>搜尋結果（共 {{ ownerTotal }} 位相符，目前顯示 {{ owners.length }} 位）：</span>
                <span>點擊即可選定</span>
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <PickerOptionRow
                  v-for="owner in owners"
                  :key="owner._id"
                  :title="owner.name"
                  :selected="selectedOwner?._id === owner._id"
                  :aria-label="`選擇飼主 ${owner.name}`"
                  @select="selectOwner(owner)"
                >
                  <template #icon><span class="text-xs font-semibold text-primary">{{ owner.name?.[0] ?? '?' }}</span></template>
                  <template #description><span v-if="owner.phone" class="block truncate text-xs">{{ owner.phone }}</span></template>
                </PickerOptionRow>
              </div>
              <div v-if="hasMoreOwners" class="pt-1 text-center">
                <Button type="button" variant="outline" size="sm" class="h-8 text-xs" :disabled="ownerLoading" @click="loadMoreOwners">載入更多結果</Button>
              </div>
            </div>

            <div v-else-if="ownerQuery.trim()" class="space-y-2 rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
              <p>查無符合「<strong class="text-foreground">{{ ownerQuery }}</strong>」的既有飼主</p>
              <Button type="button" variant="outline" size="sm" class="h-8 text-xs text-primary hover:text-primary" @click="switchModeToNewWithQuery">直接建立此飼主資料 &rarr;</Button>
            </div>

            <p v-else class="rounded-xl border border-border/50 bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">輸入飼主姓名或手機號碼，系統將即時查詢並列出相符檔案。</p>
          </div>
        </template>

        <!-- 模式 2：建立新飼主 -->
        <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div class="space-y-1.5">
            <Label for="new-owner-name" class="text-xs font-medium text-foreground">飼主姓名 <span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
            <Input
              id="new-owner-name"
              v-model="newOwner.name"
              autocomplete="name"
              class="h-9 text-sm"
              :class="{ 'border-destructive focus-visible:ring-destructive': errors.newOwnerName }"
              placeholder="例：王小明"
              @input="errors.newOwnerName = ''"
            />
            <p v-if="errors.newOwnerName" class="text-xs text-destructive">{{ errors.newOwnerName }}</p>
          </div>
          <div class="space-y-1.5">
            <Label for="new-owner-phone" class="text-xs font-medium text-foreground">聯絡電話 <span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
            <Input
              id="new-owner-phone"
              v-model="newOwner.phone"
              type="tel"
              autocomplete="tel"
              inputmode="tel"
              class="h-9 text-sm"
              :class="{ 'border-destructive focus-visible:ring-destructive': errors.newOwnerPhone }"
              placeholder="例：0912-345-678"
              @input="errors.newOwnerPhone = ''"
            />
            <p v-if="errors.newOwnerPhone" class="text-xs text-destructive">{{ errors.newOwnerPhone }}</p>
          </div>
          <div class="space-y-1.5">
            <Label for="new-owner-email" class="text-xs font-medium text-foreground">電子信箱（選填）</Label>
            <Input
              id="new-owner-email"
              v-model="newOwner.email"
              type="email"
              autocomplete="email"
              class="h-9 text-sm"
              :class="{ 'border-destructive focus-visible:ring-destructive': errors.newOwnerEmail }"
              placeholder="例：owner@example.com"
              @input="errors.newOwnerEmail = ''"
            />
            <p v-if="errors.newOwnerEmail" class="text-xs text-destructive">{{ errors.newOwnerEmail }}</p>
          </div>
          <div class="space-y-1.5">
            <Label for="new-owner-address" class="text-xs font-medium text-foreground">通訊地址（選填）</Label>
            <Input id="new-owner-address" v-model="newOwner.address" autocomplete="street-address" class="h-9 text-sm" placeholder="例：台北市中山區中山北路…" />
          </div>
        </div>
      </div>

      <!-- 貓咪基本資料 -->
      <div class="space-y-4 border-t border-border pt-6">
        <div class="flex items-center gap-2">
          <Cat class="h-4 w-4 text-primary" stroke-width="2" />
          <h2 class="text-xs font-semibold tracking-wide text-foreground uppercase">貓咪基本資料</h2>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for="new-pet-name" class="text-xs font-medium text-foreground">貓咪名字 <span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
            <Input
              id="new-pet-name"
              v-model="petForm.name"
              autocomplete="off"
              class="h-9 text-sm"
              :class="{ 'border-destructive focus-visible:ring-destructive': errors.petName }"
              placeholder="例：咪咪、茶茶、麻糬"
              @input="errors.petName = ''"
            />
            <p v-if="errors.petName" class="text-xs text-destructive">{{ errors.petName }}</p>
          </div>
          <div class="space-y-1.5">
            <Label for="new-pet-breed" class="text-xs font-medium text-foreground">品種</Label>
            <Input id="new-pet-breed" v-model="petForm.breed" class="h-9 text-sm" placeholder="例：米克斯、美短、布偶貓" />
          </div>
        </div>

        <!-- 品種快選：跟其他欄位齊平，不再另包一層邊框面板 -->
        <div class="space-y-1.5">
          <span class="text-xs text-muted-foreground">常見貓品種快速帶入：</span>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="b in CAT_BREED_RECOMMENDATIONS"
              :key="b"
              type="button"
              class="rounded-lg border border-border px-2.5 py-1 text-xs text-foreground transition-colors hover:border-primary hover:bg-accent hover:text-primary"
              :class="{ 'border-primary bg-accent font-medium text-primary': petForm.breed === b }"
              @click="applyBreed(b)"
            >
              {{ b }}
            </button>
          </div>
        </div>

        <!-- 出生日期＋年齡推算：永遠並排顯示，不做展開收合 -->
        <div class="space-y-2">
          <Label for="new-pet-birth-date" class="text-xs font-medium text-foreground">{{ petForm.birthDateEstimated ? '預估生日' : '出生日期' }}</Label>
          <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
            <DatePicker id="new-pet-birth-date" v-model="petForm.birthDate" aria-label="出生日期" class="h-9 text-sm lg:w-52" @update:model-value="petForm.birthDateEstimated = false" />
            <div v-if="computedAgeText" class="flex shrink-0 items-center gap-1.5 rounded-lg border border-success/30 bg-success-surface px-3 py-2 text-xs font-medium text-success">
              <Clock class="h-3.5 w-3.5" />
              <span>{{ computedAgeText }}</span>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground lg:ml-auto">
              <Calculator class="h-3.5 w-3.5 shrink-0 text-primary" />
              <span>不知道生日？概略年齡：</span>
              <Input v-model.number="calcYears" type="number" min="0" max="30" class="h-8 w-14 text-center text-xs" aria-label="估算年數" />
              <span>歲</span>
              <Input v-model.number="calcMonths" type="number" min="0" max="11" class="h-8 w-14 text-center text-xs" aria-label="估算月數" />
              <span>月</span>
              <Button type="button" size="sm" class="h-8 gap-1 text-xs" @click="applyAgeCalculation"><Sparkles class="h-3 w-3" />套用</Button>
            </div>
          </div>
          <p v-if="petForm.birthDateEstimated" class="text-xs text-muted-foreground">此日期由概略年齡回推，僅代表預估月份；系統以該月 1 日儲存並標示為推估。</p>
        </div>

        <div class="grid gap-4 sm:grid-cols-3">
          <div class="space-y-1.5">
            <Label class="text-xs font-medium text-foreground">性別</Label>
            <SegmentedControl v-model="petForm.sex" :options="SEX_OPTIONS" aria-label="寵物性別" size="sm" full-width />
          </div>
          <div class="space-y-1.5">
            <Label class="text-xs font-medium text-foreground">絕育狀態</Label>
            <SegmentedControl v-model="petForm.neutered" :options="NEUTERED_OPTIONS" aria-label="絕育狀態" size="sm" full-width />
          </div>
          <div class="space-y-1.5">
            <Label for="new-pet-weight" class="text-xs font-medium text-foreground">目前體重</Label>
            <div class="relative flex items-center">
              <Input id="new-pet-weight" v-model="petForm.weightKg" type="number" step="0.05" min="0" class="h-9 pr-10 text-sm" placeholder="例：4.5" />
              <span class="pointer-events-none absolute right-3 text-xs font-semibold text-muted-foreground">kg</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 醫療病史（選填，永遠攤開） -->
      <div class="space-y-4 border-t border-border pt-6">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <HeartPulse class="h-4 w-4 text-primary" stroke-width="2" />
            <h2 class="text-xs font-semibold tracking-wide text-foreground uppercase">醫療病史與生活備註（選填）</h2>
          </div>
          <Badge v-if="filledMedicalCount > 0" variant="secondary" class="bg-accent px-2 py-0 text-xs text-primary">已填寫 {{ filledMedicalCount }} 項</Badge>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for="new-pet-allergies" class="text-xs font-medium text-foreground">過敏紀錄</Label>
            <Textarea id="new-pet-allergies" v-model="petForm.allergies" rows="2" class="text-sm" placeholder="例：對某類抗生素或特定蛋白質過敏…" />
          </div>
          <div class="space-y-1.5">
            <Label for="new-pet-chronic" class="text-xs font-medium text-foreground">慢性病／重要病史</Label>
            <Textarea id="new-pet-chronic" v-model="petForm.chronicConditions" rows="2" class="text-sm" placeholder="例：慢性腎病 (CKD)、肥厚型心肌病 (HCM)、貓愛滋/白血 (FIV/FeLV)…" />
          </div>
          <div class="space-y-1.5">
            <Label for="new-pet-medications" class="text-xs font-medium text-foreground">目前用藥</Label>
            <Textarea id="new-pet-medications" v-model="petForm.currentMedications" rows="2" class="text-sm" placeholder="例：每日服用降血壓藥 (Amodip)、定期皮下輸液、關節保養…" />
          </div>
          <div class="space-y-1.5">
            <Label for="new-pet-notes" class="text-xs font-medium text-foreground">其他備註與個性提醒</Label>
            <Textarea id="new-pet-notes" v-model="petForm.notes" rows="2" class="text-sm" placeholder="例：到院極易緊迫、需毛巾包覆保定、就診前已服用 Gabapentin、剪指甲較敏感…" />
          </div>
        </div>
      </div>
    </Card>

    <!-- 底部固定操作列 -->
    <div class="sticky bottom-0 z-20 -mx-4 border-t border-border bg-card/95 px-4 py-3.5 shadow-lg backdrop-blur-md sm:mx-0 sm:rounded-2xl sm:border sm:px-6">
      <div class="flex items-center justify-between">
        <div class="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
          <span v-if="activeOwnerName">飼主：<strong class="font-medium text-foreground">{{ activeOwnerName }}</strong></span>
          <span v-if="petForm.name">・貓咪：<strong class="font-medium text-foreground">{{ petForm.name }}</strong><span v-if="petForm.breed">（{{ petForm.breed }}）</span></span>
        </div>
        <div class="flex w-full items-center justify-end gap-3 sm:w-auto">
          <Button type="button" variant="outline" :disabled="submitting" @click="cancel">取消返回</Button>
          <Button type="button" class="min-w-36 gap-1.5" :disabled="submitting" @click="submit">
            <Check class="h-4 w-4" />
            {{ submitting ? '處理中…' : '確認新增貓咪' }}
          </Button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :open="Boolean(pendingLeavePath)"
      title="確定要離開新增頁面嗎？"
      description="您填寫的貓咪或飼主資料尚未送出儲存，離開後內容將會遺失。"
      confirm-label="確認離開"
      cancel-label="繼續填寫"
      :destructive="true"
      @update:open="(value) => !value && (pendingLeavePath = '')"
      @confirm="confirmLeave"
    />
  </section>
</template>
