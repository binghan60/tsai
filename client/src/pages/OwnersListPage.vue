<script setup>
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Mail, Pencil, Phone, Trash2, Users } from '@lucide/vue';
import OwnerFormDialog from '../components/OwnerFormDialog.vue';
import SearchPanel from '../components/SearchPanel.vue';
import { http } from '../api/http';

const route = useRoute();
const router = useRouter();
const owners = ref([]);
const query = ref('');
const loading = ref(false);
const error = ref('');
const showCreate = ref(false);
const creating = ref(false);
const createError = ref('');
const deletingId = ref(null);
const editTarget = ref(null);
const editSaving = ref(false);
const editError = ref('');

async function fetchOwners() {
  loading.value = true;
  error.value = '';
  try {
    const { data } = await http.get('/owners', { params: query.value ? { q: query.value } : {} });
    owners.value = data;
  } catch (err) {
    error.value = '飼主資料暫時無法載入，請稍後重試';
  } finally {
    loading.value = false;
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
    await router.push(`/owners/${data._id}?addPet=1`);
  } catch (err) {
    createError.value = err.response?.data?.message ?? '新增飼主失敗';
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
    await http.put(`/owners/${editTarget.value._id}`, values);
    editTarget.value = null;
    await fetchOwners();
  } catch (err) {
    editError.value = err.response?.data?.message ?? '編輯飼主失敗';
  } finally {
    editSaving.value = false;
  }
}

async function removeOwner(owner) {
  if (!window.confirm(`確定要刪除飼主「${owner.name}」嗎？此操作無法復原。`)) return;
  deletingId.value = owner._id;
  error.value = '';
  try {
    await http.delete(`/owners/${owner._id}`);
    await fetchOwners();
  } catch (err) {
    error.value = err.response?.data?.message ?? '刪除飼主失敗';
  } finally {
    deletingId.value = null;
  }
}

let debounceTimer;
watch(query, () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fetchOwners, 300);
});

onMounted(() => {
  fetchOwners();
  if (route.query.create === '1') openCreate();
});
</script>

<template>
  <section class="mx-auto max-w-7xl space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold text-ink-900 dark:text-white">飼主資料</h1>
        <p class="mt-1 text-sm text-ink-500 dark:text-zinc-400">管理聯絡資訊與名下寵物。</p>
      </div>
      <button type="button" class="min-h-11 rounded-xl bg-belle-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-belle-700 dark:bg-brand-500 dark:hover:bg-brand-600" @click="openCreate">
        + 新增飼主
      </button>
    </div>

    <SearchPanel id="owner-search" v-model="query" label="搜尋飼主" placeholder="輸入姓名或電話" />

    <p v-if="error" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">{{ error }}</p>
    <p v-else-if="loading" class="text-sm text-ink-500 dark:text-zinc-400" role="status">載入飼主資料…</p>

    <template v-else>
      <p class="text-xs text-ink-400 dark:text-zinc-400">共 {{ owners.length }} 位飼主</p>

      <div v-if="owners.length" class="hidden overflow-hidden rounded-2xl border border-cream-300 bg-cream-50 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 md:block">
        <table class="w-full text-left text-sm">
          <thead><tr class="border-b border-cream-300 text-ink-500 dark:border-zinc-800 dark:text-zinc-400"><th class="px-5 py-3 font-medium">姓名</th><th class="px-5 py-3 font-medium">電話</th><th class="px-5 py-3 font-medium">Email</th><th class="px-5 py-3 text-right font-medium">操作</th></tr></thead>
          <tbody>
            <tr v-for="owner in owners" :key="owner._id" class="border-b border-cream-200 transition-colors last:border-0 hover:bg-cream-100 dark:border-zinc-800 dark:hover:bg-zinc-800/40">
              <td class="px-5 py-3"><router-link :to="`/owners/${owner._id}`" class="group flex min-h-11 items-center gap-3"><span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-belle-50 text-xs font-semibold text-belle-600 dark:bg-brand-500/10 dark:text-brand-400">{{ owner.name?.[0] ?? '?' }}</span><span class="font-medium text-belle-600 group-hover:text-belle-700 dark:text-brand-400">{{ owner.name }}</span></router-link></td>
              <td class="px-5 py-3 text-ink-600 dark:text-zinc-300"><span class="flex items-center gap-2"><Phone class="h-4 w-4 text-ink-400 dark:text-zinc-400" />{{ owner.phone }}</span></td>
              <td class="px-5 py-3 text-ink-600 dark:text-zinc-300">{{ owner.email || '—' }}</td>
              <td class="px-5 py-3"><div class="flex justify-end gap-1"><button type="button" :disabled="deletingId === owner._id" class="flex h-11 w-11 items-center justify-center rounded-xl text-ink-500 hover:bg-cream-200 hover:text-belle-600 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-brand-400" :aria-label="`編輯飼主 ${owner.name}`" @click="openEdit(owner)"><Pencil class="h-4 w-4" /></button><button type="button" :disabled="deletingId === owner._id" class="flex h-11 w-11 items-center justify-center rounded-xl text-ink-500 hover:bg-red-50 hover:text-red-700 dark:text-zinc-400 dark:hover:bg-red-950/40 dark:hover:text-red-300" :aria-label="`刪除飼主 ${owner.name}`" @click="removeOwner(owner)"><Trash2 class="h-4 w-4" /></button></div></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="owners.length" class="space-y-3 md:hidden">
        <article v-for="owner in owners" :key="owner._id" class="rounded-2xl border border-cream-300 bg-cream-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div class="flex items-start gap-3">
            <router-link :to="`/owners/${owner._id}`" class="flex min-w-0 flex-1 items-center gap-3"><span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-belle-50 text-sm font-semibold text-belle-600 dark:bg-brand-500/10 dark:text-brand-400">{{ owner.name?.[0] ?? '?' }}</span><span class="min-w-0"><span class="block font-semibold text-ink-900 dark:text-white">{{ owner.name }}</span><span class="mt-0.5 flex items-center gap-1.5 text-sm text-ink-500 dark:text-zinc-400"><Phone class="h-3.5 w-3.5" />{{ owner.phone }}</span><span v-if="owner.email" class="mt-0.5 flex items-center gap-1.5 truncate text-xs text-ink-400 dark:text-zinc-400"><Mail class="h-3.5 w-3.5" />{{ owner.email }}</span></span></router-link>
            <div class="flex shrink-0"><button class="flex h-11 w-11 items-center justify-center rounded-xl text-ink-500 dark:text-zinc-400" :aria-label="`編輯飼主 ${owner.name}`" @click="openEdit(owner)"><Pencil class="h-4 w-4" /></button><button class="flex h-11 w-11 items-center justify-center rounded-xl text-ink-500 dark:text-zinc-400" :aria-label="`刪除飼主 ${owner.name}`" @click="removeOwner(owner)"><Trash2 class="h-4 w-4" /></button></div>
          </div>
        </article>
      </div>

      <div v-if="owners.length === 0" class="rounded-2xl border border-dashed border-cream-300 px-5 py-14 text-center dark:border-zinc-800"><Users class="mx-auto mb-2 h-8 w-8 text-ink-400 dark:text-zinc-500" /><p class="text-sm text-ink-500 dark:text-zinc-400">找不到符合條件的飼主</p></div>
    </template>

    <OwnerFormDialog v-if="editTarget" title="編輯飼主資料" submit-label="儲存" :initial-value="{ name: editTarget.name, phone: editTarget.phone, email: editTarget.email ?? '' }" :submitting="editSaving" :error-message="editError" @submit="submitEdit" @close="editTarget = null" />
    <OwnerFormDialog v-if="showCreate" title="新增飼主資料" submit-label="下一步：新增寵物" :submitting="creating" :error-message="createError" @submit="createOwner" @close="showCreate = false" />
  </section>
</template>
