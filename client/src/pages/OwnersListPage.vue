<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Mail, Pencil, Phone, Trash2, Users } from '@lucide/vue';
import OwnerFormDialog from '../components/OwnerFormDialog.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { http } from '../api/http';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import EmptyState from '../components/EmptyState.vue';
import { Alert, AlertDescription } from '../components/ui/alert';
import ListSkeleton from '../components/ListSkeleton.vue';
import SearchPanel from '../components/SearchPanel.vue';

import { useToast } from '../composables/useToast';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const owners = ref([]);
const page = useSearchQueryParam('page', '1');
const query = useSearchQueryParam('q');
const density = ref('comfortable');
const total = ref(0);
const limit = ref(25);
const loading = ref(false);
const error = ref('');
const showCreate = ref(false);
const creating = ref(false);
const createError = ref('');
const deletingId = ref(null);
const checkingOwnerId = ref(null);
const ownerToRemove = ref(null);
const ownerPetBlock = ref(null);
const editTarget = ref(null);
const editSaving = ref(false);
const editError = ref('');

let requestSequence = 0;
let searchTimer;

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
      limit.value = data.limit ?? 25;
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

watch(page, fetchOwners, { immediate: true });
watch(query, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (page.value !== '1') page.value = '1';
    else fetchOwners();
  }, 250);
});

onBeforeUnmount(() => {
  clearTimeout(searchTimer);
  requestSequence += 1;
});

onMounted(() => {
  if (route.query.create === '1') openCreate();
});

const currentPage = computed(() => Number(page.value) || 1);
const totalPages = computed(() => Math.max(Math.ceil(total.value / limit.value), 1));

function goToPage(next) {
  const target = Math.min(Math.max(next, 1), totalPages.value);
  if (target !== currentPage.value) page.value = String(target);
}
</script>

<template>
  <section class="mx-auto max-w-7xl space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold text-foreground">飼主資料</h1>
        <p class="mt-1 text-sm text-muted-foreground">管理聯絡資訊與名下寵物。</p>
      </div>
      <Button type="button" @click="openCreate">+ 新增飼主</Button>
    </div>

    <SearchPanel
      id="owner-list-search"
      v-model="query"
      label="搜尋飼主"
      placeholder="搜尋姓名或電話"
      :loading="loading && Boolean(query.trim())"
    >
      <div class="mt-3 hidden items-center justify-between border-t border-border pt-3 lg:flex">
        <span class="text-xs text-muted-foreground">大量資料可切換成精簡列高，一頁更容易掃描。</span>
        <div class="inline-flex rounded-lg border border-border bg-muted/30 p-1" aria-label="飼主清單顯示密度">
          <button type="button" class="min-h-9 rounded-md px-3 text-sm font-medium" :class="density === 'comfortable' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'" :aria-pressed="density === 'comfortable'" @click="density = 'comfortable'">舒適</button>
          <button type="button" class="min-h-9 rounded-md px-3 text-sm font-medium" :class="density === 'compact' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'" :aria-pressed="density === 'compact'" @click="density = 'compact'">精簡</button>
        </div>
      </div>
    </SearchPanel>

    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <ListSkeleton v-else-if="loading" :rows="5" />

    <template v-else>
      <p class="text-xs tabular-nums text-muted-foreground">共 {{ total }} 位飼主</p>

      <Card v-if="owners.length" class="hidden gap-0 overflow-hidden py-0 shadow-sm lg:block" :class="density === 'compact' ? '[&_td]:py-1' : ''">
        <Table>
          <TableHeader>
            <TableRow class="border-border text-muted-foreground"><TableHead class="font-medium">姓名</TableHead><TableHead class="font-medium">電話</TableHead><TableHead class="font-medium">Email</TableHead><TableHead class="text-right font-medium">操作</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="owner in owners" :key="owner._id" class="border-border">
              <TableCell ><router-link :to="`/owners/${owner._id}`" class="group flex items-center gap-3"><span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-belle-50 text-xs font-semibold text-belle-600 dark:bg-brand-500/10 dark:text-brand-400">{{ owner.name?.[0] ?? '?' }}</span><span class="font-medium text-belle-600 group-hover:text-belle-700 dark:text-brand-400">{{ owner.name }}</span></router-link></TableCell>
              <TableCell class="tabular-nums text-foreground"><span class="flex items-center gap-2"><Phone class="h-4 w-4 text-muted-foreground" />{{ owner.phone }}</span></TableCell>
              <TableCell class="text-foreground">{{ owner.email || '—' }}</TableCell>
              <TableCell ><div class="flex justify-end gap-1"><Button type="button" variant="ghost" size="icon" class="h-11 w-11" :disabled="deletingId === owner._id || checkingOwnerId === owner._id" :aria-label="`編輯飼主 ${owner.name}`" @click="openEdit(owner)"><Pencil class="h-4 w-4" /></Button><Button type="button" variant="destructive" size="icon" class="h-11 w-11" :disabled="deletingId === owner._id || checkingOwnerId === owner._id" :aria-label="`刪除飼主 ${owner.name}`" @click="openRemoveOwner(owner)"><Trash2 class="h-4 w-4" /></Button></div></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      <div v-if="owners.length" class="space-y-3 lg:hidden">
        <Card v-for="owner in owners" :key="owner._id" class="p-4">
          <div class="flex items-start gap-3">
            <router-link :to="`/owners/${owner._id}`" class="flex min-w-0 flex-1 items-center gap-3"><span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-belle-50 text-sm font-semibold text-belle-600 dark:bg-brand-500/10 dark:text-brand-400">{{ owner.name?.[0] ?? '?' }}</span><span class="min-w-0"><span class="block font-semibold text-foreground">{{ owner.name }}</span><span class="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground"><Phone class="h-3.5 w-3.5" />{{ owner.phone }}</span><span v-if="owner.email" class="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground"><Mail class="h-3.5 w-3.5" />{{ owner.email }}</span></span></router-link>
            <div class="flex shrink-0"><Button type="button" variant="ghost" size="icon" class="h-11 w-11" :disabled="deletingId === owner._id || checkingOwnerId === owner._id" :aria-label="`編輯飼主 ${owner.name}`" @click="openEdit(owner)"><Pencil class="h-4 w-4" /></Button><Button type="button" variant="destructive" size="icon" class="h-11 w-11" :disabled="deletingId === owner._id || checkingOwnerId === owner._id" :aria-label="`刪除飼主 ${owner.name}`" @click="openRemoveOwner(owner)"><Trash2 class="h-4 w-4" /></Button></div>
          </div>
        </Card>
      </div>

      <EmptyState v-if="owners.length === 0" :icon="Users" :title="query ? '找不到符合條件的飼主' : '尚未建立飼主資料'" />

      <div v-if="totalPages > 1" class="flex items-center justify-between gap-3">
        <p class="text-xs tabular-nums text-muted-foreground">第 {{ currentPage }} / {{ totalPages }} 頁</p>
        <div class="flex gap-2">
          <Button type="button" variant="outline" size="sm" class="hidden sm:inline-flex" :disabled="currentPage <= 1" @click="goToPage(1)">第一頁</Button>
          <Button type="button" variant="outline" size="sm" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)">上一頁</Button>
          <Button type="button" variant="outline" size="sm" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)">下一頁</Button>
          <Button type="button" variant="outline" size="sm" class="hidden sm:inline-flex" :disabled="currentPage >= totalPages" @click="goToPage(totalPages)">最後頁</Button>
        </div>
      </div>
    </template>

    <OwnerFormDialog v-if="editTarget" title="編輯飼主資料" submit-label="儲存" :initial-value="{ name: editTarget.name, phone: editTarget.phone, email: editTarget.email ?? '' }" :submitting="editSaving" :error-message="editError" @submit="submitEdit" @close="editTarget = null" />
    <OwnerFormDialog v-if="showCreate" title="新增飼主資料" submit-label="下一步：新增寵物" :submitting="creating" :error-message="createError" @submit="createOwner" @close="showCreate = false" />
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
