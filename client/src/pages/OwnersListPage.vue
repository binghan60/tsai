<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Mail, Pencil, Phone, Trash2, Users } from '@lucide/vue';
import OwnerFormDialog from '../components/OwnerFormDialog.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { http } from '../api/http';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import FilterBar from '../components/FilterBar.vue';
import EmptyState from '../components/EmptyState.vue';
import Pagination from '../components/Pagination.vue';
import { Alert, AlertDescription } from '../components/ui/alert';
import ListSkeleton from '../components/ListSkeleton.vue';
import { emptyOwnerDraft } from '../lib/formDrafts';

import { useToast } from '../composables/useToast';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const owners = ref([]);
const page = useSearchQueryParam('page', '1');
const query = useSearchQueryParam('q');
const total = ref(0);
const limit = ref(10);
const loading = ref(false);
const error = ref('');
const showCreate = ref(false);
const creating = ref(false);
const createError = ref('');
const createDraft = ref(emptyOwnerDraft());
const deletingId = ref(null);
const checkingOwnerId = ref(null);
const ownerToRemove = ref(null);
const ownerPetBlock = ref(null);
const editTarget = ref(null);
const editSaving = ref(false);
const editError = ref('');

let requestSequence = 0;

async function fetchOwners() {
  const currentRequest = ++requestSequence;
  loading.value = true;
  error.value = '';
  try {
    const { data } = await http.get('/owners', {
      params: {
        page: Number(page.value) || 1,
        ...(query.value.trim() ? { q: query.value.trim() } : {}),
      },
    });
    if (currentRequest === requestSequence) {
      owners.value = data.items ?? [];
      total.value = data.total ?? 0;
      limit.value = data.limit ?? 10;
      if (!owners.value.length && total.value > 0 && currentPage.value > data.totalPages) {
        page.value = String(data.totalPages);
      }
    }
  } catch (err) {
    if (currentRequest === requestSequence) error.value = '飼主資料暫時無法載入，請稍後重試';
  } finally {
    if (currentRequest === requestSequence) loading.value = false;
  }
}

function openCreate() {
  createError.value = '';
  showCreate.value = true;
}

async function createOwner(values) {
  creating.value = true;
  createError.value = '';
  try {
    const { data } = await http.post('/owners', values);
    showCreate.value = false;
    createDraft.value = emptyOwnerDraft();
    toast.success(`已成功新增飼主「${data.name || values.name}」`, '新增飼主成功');
    await router.push(`/owners/${data._id}?addPet=1`);
  } catch (err) {
    createError.value = err.response?.data?.message ?? '新增飼主失敗';
    toast.error(createError.value, '新增飼主失敗');
  } finally {
    creating.value = false;
  }
}

function openEdit(owner) {
  editError.value = '';
  editTarget.value = owner;
}

async function submitEdit(values) {
  editSaving.value = true;
  editError.value = '';
  try {
    await http.put(`/owners/${editTarget.value._id}`, {
      ...values,
      expectedVersion: editTarget.value.__v,
    });
    editTarget.value = null;
    toast.success(`已成功更新飼主「${values.name}」的資料`, '修改資料成功');
    await fetchOwners();
  } catch (err) {
    editError.value = err.response?.data?.message ?? '編輯飼主失敗';
    toast.error(editError.value, '修改資料失敗');
    if (err.response?.status === 409) {
      editTarget.value = null;
      await fetchOwners();
    }
  } finally {
    editSaving.value = false;
  }
}

async function removeOwner(owner) {
  if (!owner) return;
  const targetName = owner.name;
  deletingId.value = owner._id;
  error.value = '';
  try {
    await http.delete(`/owners/${owner._id}`);
    ownerToRemove.value = null;
    toast.success(`已成功刪除飼主「${targetName}」`, '刪除成功');
    await fetchOwners();
  } catch (err) {
    error.value = err.response?.data?.message ?? '刪除飼主失敗';
    toast.error(error.value, '刪除失敗');
  } finally {
    deletingId.value = null;
  }
}

async function openRemoveOwner(owner) {
  if (deletingId.value || checkingOwnerId.value) return;
  checkingOwnerId.value = owner._id;
  try {
    const { data } = await http.get(`/owners/${owner._id}/pets`, { params: { limit: 5 } });
    if (data.total > 0) {
      ownerPetBlock.value = { owner, pets: data.items, total: data.total };
    } else {
      ownerToRemove.value = owner;
    }
  } catch (err) {
    toast.error('檢查飼主名下寵物失敗，請稍後再試', '無法刪除');
  } finally {
    checkingOwnerId.value = null;
  }
}

function goManagePets() {
  if (!ownerPetBlock.value) return;
  const id = ownerPetBlock.value.owner._id;
  ownerPetBlock.value = null;
  router.push(`/owners/${id}`);
}

// 關鍵字選好、按下搜尋才查——邊打邊查在每個系統打字習慣不一樣的情況下容易誤觸，
// 全站搜尋一律走提交式，不做即時。
function applyFilters() {
  if (page.value !== '1') page.value = '1';
  else fetchOwners();
}

watch(page, fetchOwners, { immediate: true });

onBeforeUnmount(() => {
  requestSequence += 1;
});

onMounted(() => {
  if (route.query.create === '1') openCreate();
});

const currentPage = computed(() => Number(page.value) || 1);
const totalPages = computed(() => Math.max(Math.ceil(total.value / limit.value), 1));
const paddingRows = computed(() => Math.max(0, limit.value - owners.value.length));

function goToPage(next) {
  const target = Math.min(Math.max(next, 1), totalPages.value);
  if (target !== currentPage.value) page.value = String(target);
}
</script>

<template>
  <section class="mx-auto max-w-7xl space-y-5">
    <div>
      <h1 class="text-xl font-semibold text-foreground">飼主資料</h1>
      <p class="mt-1 text-sm text-muted-foreground">管理聯絡資訊與名下寵物。</p>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <FilterBar id="owner-list-search" v-model="query" label="搜尋飼主" placeholder="搜尋姓名或電話" class="max-w-lg" @submit="applyFilters" />
      <Button type="button" @click="openCreate">+ 新增飼主</Button>
    </div>

    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <ListSkeleton v-else-if="loading" :rows="5" />

    <template v-else>
      <Card v-if="owners.length" class="hidden overflow-hidden p-0 shadow-sm xl:block">
        <div class="flex h-11 items-center border-b border-border bg-muted/40 px-6">
          <span class="flex-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">姓名</span>
          <span class="w-52 text-xs font-semibold tracking-wide text-muted-foreground uppercase">電話</span>
          <span class="w-56 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Email</span>
          <span class="w-24"></span>
        </div>
        <div v-for="owner in owners" :key="owner._id" class="flex items-center gap-3 border-b border-border/60 px-6 py-3.5 last:border-b-0">
          <router-link :to="`/owners/${owner._id}`" class="flex min-w-0 flex-1 items-center gap-3.5">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">{{ owner.name?.[0] ?? '?' }}</span>
            <span class="truncate text-sm font-semibold text-primary">{{ owner.name }}</span>
          </router-link>
          <span class="flex w-52 items-center gap-2 text-sm tabular-nums text-foreground"><Phone class="h-4 w-4 shrink-0 text-muted-foreground" />{{ owner.phone }}</span>
          <span class="w-56 truncate text-sm text-foreground">{{ owner.email || '—' }}</span>
          <span class="flex w-24 shrink-0 justify-end gap-1">
            <Button type="button" variant="ghost" size="icon-sm" :disabled="deletingId === owner._id || checkingOwnerId === owner._id" :aria-label="`編輯飼主 ${owner.name}`" @click="openEdit(owner)"><Pencil class="h-4 w-4" /></Button>
            <Button type="button" variant="destructive" size="icon-sm" :disabled="deletingId === owner._id || checkingOwnerId === owner._id" :aria-label="`刪除飼主 ${owner.name}`" @click="openRemoveOwner(owner)"><Trash2 class="h-4 w-4" /></Button>
          </span>
        </div>
        <div
          v-for="n in paddingRows"
          :key="`pad-${n}`"
          class="flex items-center gap-3 border-b border-border/60 px-6 py-3.5 last:border-b-0"
          aria-hidden="true"
        >
          <span class="flex min-w-0 flex-1 items-center gap-3.5">
            <span class="h-10 w-10 shrink-0 rounded-full"></span>
            <span class="text-sm text-transparent">.</span>
          </span>
        </div>
      </Card>

      <div v-if="owners.length" class="space-y-3 xl:hidden">
        <Card v-for="owner in owners" :key="owner._id" class="p-4">
          <div class="flex items-start gap-3">
            <router-link :to="`/owners/${owner._id}`" class="flex min-w-0 flex-1 items-center gap-3"><span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">{{ owner.name?.[0] ?? '?' }}</span><span class="min-w-0"><span class="block font-semibold text-primary">{{ owner.name }}</span><span class="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground"><Phone class="h-3.5 w-3.5" />{{ owner.phone }}</span><span v-if="owner.email" class="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground"><Mail class="h-3.5 w-3.5" />{{ owner.email }}</span></span></router-link>
            <div class="flex shrink-0"><Button type="button" variant="ghost" size="icon" :disabled="deletingId === owner._id || checkingOwnerId === owner._id" :aria-label="`編輯飼主 ${owner.name}`" @click="openEdit(owner)"><Pencil class="h-4 w-4" /></Button><Button type="button" variant="destructive" size="icon" :disabled="deletingId === owner._id || checkingOwnerId === owner._id" :aria-label="`刪除飼主 ${owner.name}`" @click="openRemoveOwner(owner)"><Trash2 class="h-4 w-4" /></Button></div>
          </div>
        </Card>
      </div>

      <EmptyState v-if="owners.length === 0" :icon="Users" :title="query ? '找不到符合條件的飼主' : '尚未建立飼主資料'" />

      <Pagination :page="currentPage" :total-pages="totalPages" @update:page="goToPage" />
    </template>

    <OwnerFormDialog v-if="editTarget" title="編輯飼主資料" submit-label="儲存" :initial-value="{ name: editTarget.name, phone: editTarget.phone, email: editTarget.email ?? '' }" :submitting="editSaving" :error-message="editError" @submit="submitEdit" @close="editTarget = null" />
    <OwnerFormDialog v-if="showCreate" title="新增飼主資料" submit-label="下一步：新增寵物" :initial-value="createDraft" :submitting="creating" :error-message="createError" @submit="createOwner" @update:draft="createDraft = $event" @close="showCreate = false" />
    <ConfirmDialog
      :open="Boolean(ownerToRemove)"
      title="刪除飼主"
      :description="`確定要刪除飼主「${ownerToRemove?.name || ''}」嗎？此操作無法復原。`"
      confirm-label="刪除"
      :loading="Boolean(deletingId)"
      @update:open="(value) => !value && (ownerToRemove = null)"
      @confirm="removeOwner(ownerToRemove)"
    />
    <ConfirmDialog
      :open="Boolean(ownerPetBlock)"
      title="無法刪除飼主"
      :description="`「${ownerPetBlock?.owner?.name || ''}」底下還有 ${ownerPetBlock?.total || 0} 隻寵物（${ownerPetBlock?.pets?.map((pet) => pet.name).join('、')}${ownerPetBlock?.total > ownerPetBlock?.pets?.length ? '等' : ''}），請先刪除或轉移這些寵物，才能刪除飼主。`"
      confirm-label="前往管理寵物"
      cancel-label="關閉"
      :destructive="false"
      @update:open="(value) => !value && (ownerPetBlock = null)"
      @confirm="goManagePets"
    />
  </section>
</template>
