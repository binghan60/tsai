<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { Cat, Pencil, Trash2, User } from '@lucide/vue';
import PetFormDialog from '../components/PetFormDialog.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { http } from '../api/http';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';

const route = useRoute();
const owner = ref(null);
const error = ref('');

const showCreatePet = ref(false);
const creating = ref(false);
const createError = ref('');

const deletingPetId = ref(null);
const petToRemove = ref(null);

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
    await fetchOwner();
  } catch (err) {
    createError.value = err.response?.data?.message ?? '新增寵物失敗';
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
    await fetchOwner();
  } catch (err) {
    editPetError.value = err.response?.data?.message ?? '編輯寵物失敗';
  } finally {
    editPetSaving.value = false;
  }
}

async function removePet(pet) {
  if (!pet) return;
  deletingPetId.value = pet._id;
  error.value = '';
  try {
    await http.delete(`/pets/${pet._id}`);
    petToRemove.value = null;
    await fetchOwner();
  } catch (err) {
    error.value = err.response?.data?.message ?? '刪除寵物失敗';
  } finally {
    deletingPetId.value = null;
  }
}

function openRemovePet(pet) {
  if (deletingPetId.value) return;
  petToRemove.value = pet;
}

onMounted(async () => {
  await fetchOwner();
  if (route.query.addPet === '1') openCreatePet();
});
</script>

<template>
  <section v-if="owner" class="space-y-6">
    <router-link to="/owners" class="text-sm font-medium text-belle-600 hover:text-belle-700 dark:text-brand-400 dark:hover:text-brand-300">
      ← 回飼主列表
    </router-link>

    <Card class="border-cream-300 p-6 shadow-sm dark:border-zinc-800 dark:shadow-none">
      <div class="flex items-center gap-4">
        <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-belle-50 text-belle-600 dark:bg-brand-500/10 dark:text-brand-400">
          <User class="h-7 w-7" stroke-width="1.75" />
        </div>
        <div>
          <h1 class="text-xl font-semibold text-ink-900 dark:text-white">{{ owner.name }}</h1>
          <p class="mt-1 text-sm text-ink-500 dark:text-zinc-500">電話：{{ owner.phone }}</p>
          <p v-if="owner.email" class="text-sm text-ink-500 dark:text-zinc-500">Email：{{ owner.email }}</p>
        </div>
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
            <button
              type="button"
              :disabled="deletingPetId === pet._id"
              class="flex h-11 w-11 items-center justify-center rounded-xl text-ink-500 hover:bg-cream-200 hover:text-belle-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-brand-400"
              :aria-label="`編輯寵物 ${pet.name}`"
              @click="openEditPet(pet)"
            >
              <Pencil class="h-4 w-4" stroke-width="1.75" />
            </button>
            <button
              type="button"
              :disabled="deletingPetId === pet._id"
              class="flex h-11 w-11 items-center justify-center rounded-xl text-ink-500 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
              :aria-label="`刪除寵物 ${pet.name}`"
              @click="openRemovePet(pet)"
            >
              <Trash2 class="h-4 w-4" stroke-width="1.75" />
            </button>
          </div>
        </Card>
      </div>
      <p v-else class="rounded-2xl border border-dashed border-cream-300 px-5 py-10 text-center text-ink-400 dark:border-zinc-800 dark:text-zinc-500">
        尚無寵物資料
      </p>
    </div>

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
        microchipNumber: editPetTarget.microchipNumber,
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
  </section>
  <p v-else-if="error" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">{{ error }}</p>
  <p v-else class="text-sm text-ink-400 dark:text-zinc-500">載入中…</p>
</template>
