<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { ListPlus, Pencil, Plus, SearchX, Trash2, X } from '@lucide/vue';
import { http } from '../api/http';
import { useToast } from '../composables/useToast';
import SettingsLayout from '../components/SettingsLayout.vue';
import EmptyState from '../components/EmptyState.vue';
import ModalDialog from '../components/ModalDialog.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import FilterBar from '../components/FilterBar.vue';
import Pagination from '../components/Pagination.vue';
import ListSkeleton from '../components/ListSkeleton.vue';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

const toast = useToast();
const menus = ref([]);
const loading = ref(true);
const editor = ref(false);
const editing = ref(null);
const deleteTarget = ref(null);
const saving = ref(false);
const form = reactive({ name: '', items: [] });
const newItemText = ref('');
const queryInput = ref('');
const query = ref('');
const page = ref(1);
const PAGE_SIZE = 10;

const visibleMenus = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  if (!keyword) return menus.value;
  return menus.value.filter((menu) => `${menu.name} ${(menu.items ?? []).map((item) => item.content).join(' ')}`.toLowerCase().includes(keyword));
});
const hasFilters = computed(() => Boolean(query.value.trim()));
const totalPages = computed(() => Math.max(Math.ceil(visibleMenus.value.length / PAGE_SIZE), 1));
const pagedMenus = computed(() => visibleMenus.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

watch(query, () => { page.value = 1; });

async function load() {
  loading.value = true;
  try {
    menus.value = (await http.get('/quick-menus', { params: { includeDisabled: 1 } })).data ?? [];
  } finally {
    loading.value = false;
  }
}
function applyFilters() { query.value = queryInput.value; }
function clearFilters() { queryInput.value = ''; query.value = ''; }
function open(menu = null) {
  editing.value = menu;
  form.name = menu?.name ?? '';
  form.items = (menu?.items ?? []).map((item) => ({ content: item.content }));
  newItemText.value = '';
  editor.value = true;
}
function addItem() {
  const text = newItemText.value.trim();
  if (!text) return;
  form.items.push({ content: text });
  newItemText.value = '';
  nextTick(() => document.getElementById('quick-menu-new-item')?.focus());
}
function removeItem(index) { form.items.splice(index, 1); }
async function save() {
  saving.value = true;
  try {
    const items = form.items.filter((item) => item.content.trim()).map((item) => ({ label: item.content.trim(), content: item.content.trim(), enabled: true }));
    const data = { name: form.name, items };
    if (editing.value) await http.put(`/quick-menus/${editing.value._id}`, { ...data, expectedVersion: editing.value.__v ?? 0 });
    else await http.post('/quick-menus', data);
    toast.success('快捷選單已儲存');
    editor.value = false;
    await load();
  } catch (err) {
    toast.error(err.response?.data?.message ?? '儲存失敗');
  } finally {
    saving.value = false;
  }
}
async function remove() {
  try {
    await http.delete(`/quick-menus/${deleteTarget.value._id}`);
    deleteTarget.value = null;
    await load();
    toast.success('快捷選單已刪除');
  } catch (err) {
    toast.error(err.response?.data?.message ?? '刪除失敗');
  }
}
onMounted(load);
</script>

<template>
  <SettingsLayout title="快捷選單管理" description="建立可重複使用的純文字快捷項目，並指定給表單中的快捷選單欄位。">
    <template #actions><Button type="button" @click="open()"><Plus class="h-4 w-4" stroke-width="1.75" />新增快捷選單</Button></template>
    <ListSkeleton v-if="loading" :rows="4" :avatar="false" />

    <template v-else-if="menus.length">
      <div class="grid gap-3 xl:grid-cols-[minmax(22rem,1fr)_auto] xl:items-center">
        <FilterBar id="quick-menu-search" v-model="queryInput" label="搜尋快捷選單" placeholder="搜尋名稱或快捷項目" class="w-full min-w-0 xl:max-w-xl" @submit="applyFilters" />
      </div>
      <p class="text-sm text-muted-foreground"><template v-if="hasFilters">篩選結果 {{ visibleMenus.length }} 個，共 {{ menus.length }} 個快捷選單</template><template v-else>共 {{ menus.length }} 個快捷選單</template></p>
      <EmptyState v-if="!visibleMenus.length" :icon="SearchX" title="找不到符合的快捷選單" description="請調整搜尋條件後再試一次。"><Button type="button" variant="outline" class="mt-4" @click="clearFilters">清除搜尋</Button></EmptyState>

      <Card v-if="visibleMenus.length" class="hidden overflow-hidden p-0 shadow-sm xl:block" style="--data-columns: minmax(16rem, 1.1fr) 7rem minmax(20rem, 2fr) 8rem">
        <div class="desktop-data-header"><span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">名稱</span><span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">項目數</span><span class="desktop-data-cell text-xs font-semibold tracking-wide text-muted-foreground uppercase">快捷項目</span><span class="desktop-data-cell"></span></div>
        <div v-for="menu in pagedMenus" :key="menu._id" class="desktop-data-row">
          <button type="button" class="desktop-data-cell min-w-0 text-left" @click="open(menu)"><span class="block truncate font-semibold text-primary">{{ menu.name }}</span></button>
          <span class="desktop-data-cell text-sm text-foreground">{{ menu.items.length }} 個</span>
          <button type="button" class="desktop-data-cell min-w-0 text-left" @click="open(menu)"><span class="block truncate text-sm text-foreground">{{ menu.items.length ? menu.items.map((item) => item.content).join('、') : '尚未加入快捷項目' }}</span></button>
          <span class="desktop-data-cell flex justify-end gap-1"><Button type="button" variant="secondary" size="icon-sm" :aria-label="`編輯快捷選單 ${menu.name}`" @click="open(menu)"><Pencil class="h-4 w-4" stroke-width="1.75" /></Button><Button type="button" variant="destructive" size="icon-sm" :aria-label="`刪除快捷選單 ${menu.name}`" @click="deleteTarget = menu"><Trash2 class="h-4 w-4" stroke-width="1.75" /></Button></span>
        </div>
      </Card>

      <div v-if="visibleMenus.length" class="space-y-3 xl:hidden">
        <Card v-for="menu in pagedMenus" :key="menu._id" class="gap-3 p-4 shadow-sm">
          <button type="button" class="min-w-0 text-left" @click="open(menu)"><span class="block font-semibold text-primary">{{ menu.name }}</span><span class="mt-1 block line-clamp-2 text-sm text-muted-foreground">{{ menu.items.length ? menu.items.map((item) => item.content).join('、') : '尚未加入快捷項目' }}</span></button>
          <div class="flex items-center justify-between gap-2"><span class="text-xs text-muted-foreground">{{ menu.items.length }} 個項目</span><div class="flex gap-2"><Button type="button" size="sm" @click="open(menu)"><Pencil class="h-4 w-4" stroke-width="1.75" />編輯</Button><Button type="button" variant="destructive" size="sm" @click="deleteTarget = menu"><Trash2 class="h-4 w-4" stroke-width="1.75" />刪除</Button></div></div>
        </Card>
      </div>
      <Pagination v-if="visibleMenus.length" :page="page" :total-pages="totalPages" @update:page="page = $event" />
    </template>

    <EmptyState v-else :icon="ListPlus" title="尚未建立快捷選單" description="例如：口服藥、針劑、處置或衛教。"><Button type="button" class="mt-4" @click="open()"><Plus class="h-4 w-4" />新增快捷選單</Button></EmptyState>

    <ModalDialog v-if="editor" size="lg" @close="editor = false"><form @submit.prevent="save"><div class="space-y-5 p-6"><h2 class="text-lg font-semibold">{{ editing ? '編輯快捷選單' : '新增快捷選單' }}</h2><div class="space-y-1.5"><Label for="quick-menu-name">名稱</Label><Input id="quick-menu-name" v-model="form.name" required placeholder="例：針劑" /></div><div class="space-y-2"><Label for="quick-menu-new-item">快捷項目</Label><div class="flex gap-2"><Input id="quick-menu-new-item" v-model="newItemText" class="min-w-0 flex-1" placeholder="輸入文字後按新增" @keydown.enter.prevent="addItem" /><Button type="button" variant="secondary" @click="addItem"><Plus class="h-4 w-4" />新增</Button></div><div v-if="form.items.length" class="space-y-1.5"><div v-for="(item, index) in form.items" :key="index" class="flex items-center gap-2 rounded-lg border border-border bg-field px-3 py-2"><span class="min-w-0 flex-1 truncate text-sm text-foreground">{{ item.content }}</span><Button type="button" variant="destructive" size="icon" :aria-label="`刪除項目 ${index + 1}`" @click="removeItem(index)"><X class="h-4 w-4" /></Button></div></div><p v-else class="rounded-lg border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">尚未加入快捷項目。</p></div></div><div class="flex justify-end gap-2 border-t border-border px-6 py-4"><Button type="button" variant="outline" @click="editor = false">取消</Button><Button type="submit" :disabled="saving">{{ saving ? '儲存中…' : '儲存' }}</Button></div></form></ModalDialog>
    <ConfirmDialog :open="Boolean(deleteTarget)" title="刪除快捷選單" :description="`確定刪除「${deleteTarget?.name ?? ''}」嗎？`" confirm-label="刪除" destructive @update:open="(open) => !open && (deleteTarget = null)" @confirm="remove" />
  </SettingsLayout>
</template>
