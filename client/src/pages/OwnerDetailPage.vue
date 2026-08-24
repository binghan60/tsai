<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Cat, ClipboardPlus, Pencil, Trash2, User, X } from '@lucide/vue';
import OwnerFormDialog from '../components/OwnerFormDialog.vue';
import PetFormDialog from '../components/PetFormDialog.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { http } from '../api/http';
import { clinicDateInput } from '../lib/datetime';
import { emptyPetDraft } from '../lib/formDrafts';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import EmptyState from '../components/EmptyState.vue';
import { Alert, AlertDescription } from '../components/ui/alert';

import { useToast } from '../composables/useToast';
import { useBackTarget } from '../composables/useBackTarget';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const owner = ref(null);
const petPage = ref(1);
const petPagination = ref({ total: 0, page: 1, limit: 12, totalPages: 1 });
const { to: backTo, label: backLabel } = useBackTarget('/owners', '回飼主列表');
const error = ref('');
const editOwnerOpen = ref(false);
const editOwnerSaving = ref(false);
const editOwnerError = ref('');

const showCreatePet = ref(false);
const creating = ref(false);
const createError = ref('');
const createdPet = ref(null);
const createPetDraft = ref(emptyPetDraft());

const deletingPetId = ref(null);
const checkingPetId = ref(null);
const petToRemove = ref(null);
const petRecordBlock = ref(null);

const editPetTarget = ref(null);
const editPetSaving = ref(false);
const editPetError = ref('');
let fetchSequence = 0;

async function fetchOwner(ownerId = route.params.id) {
  const currentRequest = ++fetchSequence;
  error.value = '';
  try {
    const { data } = await http.get(`/owners/${ownerId}`, { params: { petPage: petPage.value } });
    if (currentRequest !== fetchSequence || String(route.params.id) !== String(ownerId)) return;
    owner.value = data;
    petPagination.value = data.petPagination ?? petPagination.value;
    if (!data.pets?.length && data.petPagination?.total > 0 && petPage.value > data.petPagination.totalPages) {
      petPage.value = data.petPagination.totalPages;
    }
  } catch (err) {
    if (currentRequest === fetchSequence) error.value = '飼主資料載入失敗';
  }
}

async function saveOwner(values) {
  editOwnerSaving.value = true;
  editOwnerError.value = '';
  try {
    await http.put(`/owners/${route.params.id}`, { ...values, expectedVersion: owner.value.__v });
    editOwnerOpen.value = false;
    toast.success(`已成功更新飼主「${values.name}」的資料`, '修改資料成功');
    await fetchOwner();
  } catch (err) {
    editOwnerError.value = err.response?.data?.message ?? '飼主資料儲存失敗';
    toast.error(editOwnerError.value, '修改資料失敗');
    if (err.response?.status === 409) {
      editOwnerOpen.value = false;
      await fetchOwner();
    }
  } finally {
    editOwnerSaving.value = false;
  }
}

function openCreatePet() {
  createError.value = '';
  showCreatePet.value = true;
}

function closeCreatePet() {
  showCreatePet.value = false;
}

async function createPet(values) {
  creating.value = true;
  createError.value = '';
  try {
    const { data } = await http.post(`/owners/${route.params.id}/pets`, values);
    closeCreatePet();
    createPetDraft.value = emptyPetDraft();
    createdPet.value = data;
    toast.success(`已成功新增寵物「${values.name}」`, '新增寵物成功');
    await fetchOwner();
  } catch (err) {
    createError.value = err.response?.data?.message ?? '新增寵物失敗';
    toast.error(createError.value, '新增寵物失敗');
  } finally {
    creating.value = false;
  }
}

function openEditPet(pet) {
  editPetError.value = '';
  editPetTarget.value = pet;
}

function closeEditPet() {
  editPetTarget.value = null;
}

async function submitEditPet(values) {
  editPetSaving.value = true;
  editPetError.value = '';
  try {
    await http.put(`/pets/${editPetTarget.value._id}`, {
      ...values,
      expectedVersion: editPetTarget.value.__v,
    });
    closeEditPet();
    toast.success(`已成功更新寵物「${values.name}」的資料`, '修改資料成功');
    await fetchOwner();
  } catch (err) {
    editPetError.value = err.response?.data?.message ?? '編輯寵物失敗';
    toast.error(editPetError.value, '修改資料失敗');
    if (err.response?.status === 409) {
      closeEditPet();
      await fetchOwner();
    }
  } finally {
    editPetSaving.value = false;
  }
}

async function removePet(pet) {
  if (!pet) return;
  const targetPetName = pet.name;
  deletingPetId.value = pet._id;
  error.value = '';
  try {
    await http.delete(`/pets/${pet._id}`);
    petToRemove.value = null;
    toast.success(`已成功刪除寵物「${targetPetName}」`, '刪除成功');
    await fetchOwner();
  } catch (err) {
    error.value = err.response?.data?.message ?? '刪除寵物失敗';
    toast.error(error.value, '刪除失敗');
  } finally {
    deletingPetId.value = null;
  }
}

async function openRemovePet(pet) {
  if (deletingPetId.value || checkingPetId.value) return;
  checkingPetId.value = pet._id;
  try {
    const { data } = await http.get(`/pets/${pet._id}/records`, { params: { limit: 5 } });
    if (data.total > 0) {
      petRecordBlock.value = { pet, records: data.items, total: data.total };
    } else {
      petToRemove.value = pet;
    }
  } catch (err) {
    toast.error('檢查寵物健檢紀錄失敗，請稍後再試', '無法刪除');
  } finally {
    checkingPetId.value = null;
  }
}

function goManageRecords() {
  if (!petRecordBlock.value) return;
  const id = petRecordBlock.value.pet._id;
  petRecordBlock.value = null;
  router.push(`/pets/${id}`);
}

const totalPetPages = computed(() => petPagination.value.totalPages ?? 1);

function goToPetPage(next) {
  const target = Math.min(Math.max(next, 1), totalPetPages.value);
  if (target !== petPage.value) petPage.value = target;
}

watch(petPage, () => {
  if (owner.value) fetchOwner();
});

watch(
  () => route.params.id,
  (ownerId) => {
    owner.value = null;
    petPage.value = 1;
    editOwnerOpen.value = false;
    showCreatePet.value = false;
    editPetTarget.value = null;
    petToRemove.value = null;
    petRecordBlock.value = null;
    createdPet.value = null;
    fetchOwner(ownerId);
  },
  { immediate: true }
);

watch(
  () => [route.query.edit, route.query.addPet],
  async ([editIntent, addPetIntent]) => {
    if (editIntent === '1') editOwnerOpen.value = true;
    if (addPetIntent === '1') openCreatePet();
    if (editIntent !== '1' && addPetIntent !== '1') return;
    const query = { ...route.query };
    delete query.edit;
    delete query.addPet;
    await router.replace({ query });
  },
  { immediate: true }
);
</script>

<template>
  <section v-if="owner" class="space-y-6">
    <router-link :to="backTo" class="text-sm font-medium text-primary hover:underline hover:underline-offset-4">
      ← {{ backLabel }}
    </router-link>

    <Card class="p-5 shadow-sm dark:shadow-none">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex items-center gap-4">
          <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <User class="h-7 w-7" stroke-width="1.75" />
          </div>
          <div>
            <h1 class="text-xl font-semibold text-foreground">{{ owner.name }}</h1>
            <p class="mt-1 text-sm text-muted-foreground"><span class="tabular-nums">電話：{{ owner.phone }}</span></p>
            <p class="text-sm text-muted-foreground">Email：{{ owner.email || '未填寫' }}</p>
          </div>
        </div>
        <Button type="button" variant="outline" @click="editOwnerOpen = true"><Pencil class="h-4 w-4" />編輯飼主資料</Button>
      </div>
    </Card>

    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-base font-semibold text-foreground">寵物</h2>
        <Button type="button" size="sm" @click="openCreatePet">+ 新增寵物</Button>
      </div>

      <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>

      <div v-if="createdPet" class="flex flex-wrap items-center gap-3 rounded-xl border border-success/35 bg-success-surface px-4 py-3 text-success">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold">{{ createdPet.name }} 已新增</p>
          <p class="text-xs opacity-80">可以直接建立第一份健檢，寵物資料會自動帶入。</p>
        </div>
        <Button as-child size="sm"><router-link :to="`/pets/${createdPet._id}/records/new`"><ClipboardPlus class="h-4 w-4" />建立第一份健檢</router-link></Button>
        <Button type="button" variant="ghost" size="icon" :aria-label="`關閉 ${createdPet.name} 新增成功提示`" @click="createdPet = null"><X class="h-4 w-4" /></Button>
      </div>

      <div v-if="owner.pets.length" class="grid gap-3 sm:grid-cols-2">
        <Card
          v-for="pet in owner.pets"
          :key="pet._id"
          class="flex-row items-center gap-3 border-border p-4 shadow-sm hover:border-primary/35 hover:bg-accent/40 dark:shadow-none"
        >
          <router-link :to="`/pets/${pet._id}`" class="flex min-w-0 flex-1 items-center gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"><Cat class="h-5 w-5" stroke-width="1.75" /></span>
            <span class="min-w-0">
              <span class="block truncate font-medium text-primary">{{ pet.name }}</span>
              <span class="block truncate text-xs text-muted-foreground">
                {{ pet.species || '寵物' }}<template v-if="pet.breed"> · {{ pet.breed }}</template>
              </span>
            </span>
          </router-link>
          <div class="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="h-11 w-11"
              :disabled="deletingPetId === pet._id || checkingPetId === pet._id"
              :aria-label="`編輯寵物 ${pet.name}`"
              @click="openEditPet(pet)"
            >
              <Pencil class="h-4 w-4" stroke-width="1.75" />
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="icon"
              class="h-11 w-11"
              :disabled="deletingPetId === pet._id || checkingPetId === pet._id"
              :aria-label="`刪除寵物 ${pet.name}`"
              @click="openRemovePet(pet)"
            >
              <Trash2 class="h-4 w-4" stroke-width="1.75" />
            </Button>
          </div>
        </Card>
      </div>
      <EmptyState v-else title="尚無寵物資料" />

      <div v-if="totalPetPages > 1" class="flex items-center justify-between gap-3">
        <p class="text-xs tabular-nums text-muted-foreground">共 {{ petPagination.total }} 隻・第 {{ petPage }} / {{ totalPetPages }} 頁</p>
        <div class="flex gap-2">
          <Button type="button" variant="outline" size="sm" :disabled="petPage <= 1" @click="goToPetPage(petPage - 1)">上一頁</Button>
          <Button type="button" variant="outline" size="sm" :disabled="petPage >= totalPetPages" @click="goToPetPage(petPage + 1)">下一頁</Button>
        </div>
      </div>
    </div>

    <OwnerFormDialog
      v-if="editOwnerOpen"
      title="編輯飼主資料"
      submit-label="儲存"
      :initial-value="{ name: owner.name, phone: owner.phone, email: owner.email ?? '' }"
      :submitting="editOwnerSaving"
      :error-message="editOwnerError"
      @submit="saveOwner"
      @close="editOwnerOpen = false"
    />

    <PetFormDialog
      v-if="editPetTarget"
      title="編輯寵物資料"
      submit-label="儲存"
      :initial-value="{
        name: editPetTarget.name,
        species: editPetTarget.species,
        breed: editPetTarget.breed,
        sex: editPetTarget.sex,
        neutered: editPetTarget.neutered,
        birthDate: clinicDateInput(editPetTarget.birthDate),
        weightKg: editPetTarget.weightKg,
        allergies: editPetTarget.allergies,
        chronicConditions: editPetTarget.chronicConditions,
        currentMedications: editPetTarget.currentMedications,
        notes: editPetTarget.notes,
      }"
      :submitting="editPetSaving"
      :error-message="editPetError"
      @submit="submitEditPet"
      @close="closeEditPet"
    />

    <PetFormDialog
      v-if="showCreatePet"
      title="新增寵物資料"
      submit-label="新增"
      :initial-value="createPetDraft"
      :submitting="creating"
      :error-message="createError"
      @submit="createPet"
      @update:draft="createPetDraft = $event"
      @close="closeCreatePet"
    />
    <ConfirmDialog
      :open="Boolean(petToRemove)"
      title="刪除寵物"
      :description="`確定要刪除「${petToRemove?.name || ''}」嗎？此操作無法復原。`"
      confirm-label="刪除"
      :loading="Boolean(deletingPetId)"
      @update:open="(value) => !value && (petToRemove = null)"
      @confirm="removePet(petToRemove)"
    />
    <ConfirmDialog
      :open="Boolean(petRecordBlock)"
      title="無法刪除寵物"
      :description="`「${petRecordBlock?.pet?.name || ''}」底下還有 ${petRecordBlock?.total || 0} 筆健檢紀錄，請先刪除這些紀錄，才能刪除寵物。`"
      confirm-label="前往管理健檢紀錄"
      cancel-label="關閉"
      :destructive="false"
      @update:open="(value) => !value && (petRecordBlock = null)"
      @confirm="goManageRecords"
    />
  </section>
  <Alert v-else-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
  <p v-else class="text-sm text-muted-foreground">載入中…</p>
</template>
