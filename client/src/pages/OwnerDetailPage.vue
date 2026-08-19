<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Cat, Pencil, Trash2, User } from '@lucide/vue';
import OwnerFormDialog from '../components/OwnerFormDialog.vue';
import PetFormDialog from '../components/PetFormDialog.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { http } from '../api/http';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';

import { useToast } from '../composables/useToast';
import { useBackTarget } from '../composables/useBackTarget';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const owner = ref(null);
const { to: backTo, label: backLabel } = useBackTarget('/owners', '回飼主列表');
const error = ref('');
const editOwnerOpen = ref(false);
const editOwnerSaving = ref(false);
const editOwnerError = ref('');

const showCreatePet = ref(false);
const creating = ref(false);
const createError = ref('');

const deletingPetId = ref(null);
const checkingPetId = ref(null);
const petToRemove = ref(null);
const petRecordBlock = ref(null);

const editPetTarget = ref(null);
const editPetSaving = ref(false);
const editPetError = ref('');

async function fetchOwner() {
  error.value = '';
  try {
    const { data } = await http.get(`/owners/${route.params.id}`);
    owner.value = data;
  } catch (err) {
    error.value = '飼主資料載入失敗';
  }
}

async function saveOwner(values) {
  editOwnerSaving.value = true;
  editOwnerError.value = '';
  try {
    await http.put(`/owners/${route.params.id}`, values);
    editOwnerOpen.value = false;
    toast.success(`已成功更新飼主「${values.name}」的資料`, '修改資料成功');
    await fetchOwner();
  } catch (err) {
    editOwnerError.value = err.response?.data?.message ?? '飼主資料儲存失敗';
    toast.error(editOwnerError.value, '修改資料失敗');
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
    await http.post(`/owners/${route.params.id}/pets`, values);
    closeCreatePet();
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
    await http.put(`/pets/${editPetTarget.value._id}`, values);
    closeEditPet();
    toast.success(`已成功更新寵物「${values.name}」的資料`, '修改資料成功');
    await fetchOwner();
  } catch (err) {
    editPetError.value = err.response?.data?.message ?? '編輯寵物失敗';
    toast.error(editPetError.value, '修改資料失敗');
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
    const { data: records } = await http.get(`/pets/${pet._id}/records`);
    if (records.length > 0) {
      petRecordBlock.value = { pet, records };
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

onMounted(async () => {
  await fetchOwner();
  if (route.query.edit === '1') editOwnerOpen.value = true;
  if (route.query.addPet === '1') openCreatePet();
  if (route.query.edit === '1' || route.query.addPet === '1') {
    const query = { ...route.query };
    delete query.edit;
    delete query.addPet;
    await router.replace({ query });
  }
});
</script>

<template>
  <section v-if="owner" class="space-y-6">
    <router-link :to="backTo" class="text-sm font-medium text-belle-600 hover:text-belle-700 dark:text-brand-400 dark:hover:text-brand-300">
      ← {{ backLabel }}
    </router-link>

    <Card class="border-cream-300 p-6 shadow-sm dark:border-zinc-800 dark:shadow-none">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex items-center gap-4">
          <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-belle-50 text-belle-600 dark:bg-brand-500/10 dark:text-brand-400">
            <User class="h-7 w-7" stroke-width="1.75" />
          </div>
          <div>
            <h1 class="text-xl font-semibold text-ink-900 dark:text-white">{{ owner.name }}</h1>
            <p class="mt-1 text-sm text-ink-500 dark:text-zinc-400">電話：{{ owner.phone }}</p>
            <p class="text-sm text-ink-500 dark:text-zinc-400">Email：{{ owner.email || '未填寫' }}</p>
          </div>
        </div>
        <Button type="button" variant="outline" class="min-h-11" @click="editOwnerOpen = true"><Pencil class="h-4 w-4" />編輯飼主資料</Button>
      </div>
    </Card>

    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-base font-semibold text-ink-900 dark:text-white">寵物</h2>
        <Button type="button" size="sm" class="min-h-9" @click="openCreatePet">+ 新增寵物</Button>
      </div>

      <p v-if="error" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">{{ error }}</p>

      <div v-if="owner.pets.length" class="grid gap-3 sm:grid-cols-2">
        <Card
          v-for="pet in owner.pets"
          :key="pet._id"
          class="flex-row items-center gap-3 border-cream-300 p-4 shadow-sm hover:border-belle-300 hover:bg-belle-50/40 dark:border-zinc-800 dark:shadow-none dark:hover:border-brand-500/40 dark:hover:bg-zinc-800/40"
        >
          <router-link :to="`/pets/${pet._id}`" class="flex min-w-0 flex-1 items-center gap-3">
            <Cat class="h-6 w-6 shrink-0 text-belle-600 dark:text-brand-400" stroke-width="1.75" />
            <span class="min-w-0">
              <span class="block truncate font-medium text-ink-700 dark:text-zinc-200">{{ pet.name }}</span>
              <span class="block truncate text-xs text-ink-400 dark:text-zinc-400">
                {{ pet.species || '寵物' }}<template v-if="pet.breed"> · {{ pet.breed }}</template>
                <template v-if="pet.medicalRecordNumber"> · {{ pet.medicalRecordNumber }}</template>
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
      <p v-else class="rounded-2xl border border-dashed border-cream-300 px-5 py-10 text-center text-ink-400 dark:border-zinc-800 dark:text-zinc-500">
        尚無寵物資料
      </p>
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
        birthDate: editPetTarget.birthDate?.slice(0, 10),
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
      :submitting="creating"
      :error-message="createError"
      @submit="createPet"
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
      :description="`「${petRecordBlock?.pet?.name || ''}」底下還有 ${petRecordBlock?.records?.length || 0} 筆健檢紀錄，請先刪除這些紀錄，才能刪除寵物。`"
      confirm-label="前往管理健檢紀錄"
      cancel-label="關閉"
      :destructive="false"
      @update:open="(value) => !value && (petRecordBlock = null)"
      @confirm="goManageRecords"
    />
  </section>
  <p v-else-if="error" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">{{ error }}</p>
  <p v-else class="text-sm text-ink-400 dark:text-zinc-500">載入中…</p>
</template>
