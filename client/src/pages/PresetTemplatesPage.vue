<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';
import { ChevronDown, ChevronRight, Layers, Plus, Search } from '@lucide/vue';
import { http } from '../api/http';
import { useSearchQueryParam } from '../composables/useSearchQueryParam';
import { defaultPresetFormId, presetFormGroups } from '../lib/presetForms';
import { AVAILABILITY_STATUS_META } from '../lib/recordStatus';
import SettingsLayout from '../components/SettingsLayout.vue';
import EmptyState from '../components/EmptyState.vue';
import ListSkeleton from '../components/ListSkeleton.vue';
import DataCard from '../components/DataCard.vue';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';

// 預填模板一定屬於某一份表單（欄位就是那份表單的欄位），所以是「左邊挑表單、右邊看它的模板」。
// 早期版本把表單收在下拉選單裡，使用者沒注意到要先選表單；之後改成每份表單一段、全部往下排，
// 表單一多又很難找、滿版都是「還沒有模板」。現在左欄可以搜尋（連模板名稱一起比對）、
// 有模板的排前面、已停用的收起來；選哪一份記在網址 ?form=，填報告時「管理預填模板」直接帶到那一份。
const forms = ref([]);
const loading = ref(true);
const error = ref('');
const query = ref('');
const formParam = useSearchQueryParam('form', '');
const disabledOpen = ref(false);
const formNav = ref(null);

const groups = computed(() => presetFormGroups(forms.value, query.value));
const selectedId = computed(() => defaultPresetFormId(forms.value, formParam.value));
const selected = computed(() => forms.value.find((form) => String(form._id) === selectedId.value) ?? null);
// 已停用那組預設收起；選中的就在裡面、或搜尋結果只剩那組時自動打開，免得看起來像找不到。
const showDisabled = computed(() => disabledOpen.value
  || selected.value?.enabled === false
  || (Boolean(query.value.trim()) && !groups.value.active.length));
const presetTotal = computed(() => forms.value.reduce((sum, form) => sum + (form.presets?.length || 0), 0));

function select(id) {
  formParam.value = String(id);
}

onMounted(async () => {
  try {
    const { data } = await http.get('/settings/form-templates');
    forms.value = Array.isArray(data) ? data : [];
  } catch {
    error.value = '表單清單暫時無法載入，請稍後重試';
  } finally {
    loading.value = false;
  }
  // 從填表頁或編輯頁帶 ?form= 回來時，選中的那列可能在清單很下面，捲到看得見的地方。
  await nextTick();
  formNav.value?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
});
</script>

<template>
  <SettingsLayout title="預填模板" description="每份健檢表單可以有幾組固定填法（例如預防針、牙齒），填報告時從頁首一鍵帶入。">
    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <ListSkeleton v-if="loading" :rows="4" :avatar="false" />
    <EmptyState v-else-if="!forms.length" :icon="Layers" title="還沒有健檢表單" description="先到「表單管理」建立一份表單，才能替它設定預填模板。" />

    <div v-else class="grid items-start gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <!-- 窄螢幕：左欄收成一個下拉選單。 -->
      <Select :model-value="selectedId" @update:model-value="select">
        <SelectTrigger class="w-full xl:hidden" aria-label="選擇表單"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem v-for="form in [...groups.active, ...groups.disabled]" :key="form._id" :value="String(form._id)">
            {{ form.name }}（{{ form.presets?.length || 0 }} 組{{ form.enabled === false ? '，已停用' : '' }}）
          </SelectItem>
        </SelectContent>
      </Select>

      <!-- 左欄：表單清單。長的時候自己捲，右欄不跟著跑。 -->
      <div class="hidden xl:sticky xl:top-5 xl:block">
      <DataCard title="表單" :count="forms.length" class="max-h-[calc(100dvh-2.5rem)]">
        <template #tabs>
          <div class="relative">
            <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" stroke-width="1.75" aria-hidden="true" />
            <Input v-model="query" inputmode="search" autocomplete="off" class="pl-9" placeholder="表單或模板名稱" aria-label="搜尋表單或模板" />
          </div>
        </template>
        <nav ref="formNav" class="min-h-0 flex-1 overflow-y-auto" aria-label="健檢表單">
          <p v-if="!groups.active.length && !groups.disabled.length" class="px-5 py-4 text-sm text-subtle-foreground">找不到符合的表單或模板</p>
          <template v-for="section in [{ key: 'active', list: groups.active }, { key: 'disabled', list: groups.disabled }]" :key="section.key">
            <button
              v-if="section.key === 'disabled' && section.list.length"
              type="button"
              class="flex w-full items-center gap-2 border-t border-border bg-sunken px-5 py-2.5 text-left text-sm font-semibold text-muted-foreground hover:bg-hover"
              :aria-expanded="showDisabled"
              @click="disabledOpen = !showDisabled"
            >
              <component :is="showDisabled ? ChevronDown : ChevronRight" class="size-4" stroke-width="1.75" />已停用<span class="num font-medium">{{ section.list.length }}</span>
            </button>
            <template v-if="section.key === 'active' || showDisabled">
              <button
                v-for="form in section.list"
                :key="form._id"
                type="button"
                class="flex min-h-13 w-full items-center gap-3 border-b border-border px-5 py-2 text-left last:border-b-0 hover:bg-hover"
                :class="String(form._id) === selectedId ? 'bg-accent shadow-[inset_3px_0_0_var(--primary)] hover:bg-accent' : ''"
                :aria-current="String(form._id) === selectedId ? 'true' : undefined"
                @click="select(form._id)"
              >
                <span class="min-w-0 flex-1 truncate font-semibold" :class="String(form._id) === selectedId ? 'text-accent-foreground' : form.enabled === false ? 'text-muted-foreground' : 'text-foreground'">{{ form.name }}</span>
                <span v-if="form.presets?.length" class="num shrink-0 text-sm font-semibold text-primary">{{ form.presets.length }}</span>
                <span v-else class="shrink-0 text-sm text-subtle-foreground" aria-label="沒有模板">—</span>
              </button>
            </template>
          </template>
        </nav>
      </DataCard>
      </div>

      <!-- 右欄：選中那份表單的模板。 -->
      <DataCard v-if="selected" :title="selected.name" :count="selected.presets?.length || 0">
        <template #filters>
          <Badge v-if="selected.enabled === false" variant="status" :class="AVAILABILITY_STATUS_META.disabled.class">表單已停用</Badge>
          <Button as-child variant="soft" size="sm">
            <router-link :to="`/settings/presets/${selected._id}/new`"><Plus stroke-width="1.75" />新增模板</router-link>
          </Button>
        </template>
        <ul v-if="selected.presets?.length" class="divide-y divide-border">
          <li v-for="preset in selected.presets" :key="preset.key">
            <router-link :to="`/settings/presets/${selected._id}/${preset.key}`" class="flex min-h-14 items-center gap-3 px-5 py-2 hover:bg-hover">
              <span class="min-w-0 flex-1 truncate font-semibold text-primary">{{ preset.name }}</span>
              <span class="text-sm text-subtle-foreground">設定 <span class="num">{{ preset.fieldCount }}</span> 欄</span>
              <ChevronRight class="size-5 shrink-0 text-subtle-foreground" stroke-width="1.75" />
            </router-link>
          </li>
        </ul>
        <EmptyState v-else :icon="Layers" :title="`「${selected.name}」還沒有預填模板`" description="新增一組後，填這份表單的報告時可以從頁首一鍵帶入。" inset />
        <template v-if="presetTotal" #footer>
          <p class="border-t border-border px-5 py-3 text-sm text-subtle-foreground">全部表單共 <span class="num">{{ presetTotal }}</span> 組模板</p>
        </template>
      </DataCard>
    </div>
  </SettingsLayout>
</template>
