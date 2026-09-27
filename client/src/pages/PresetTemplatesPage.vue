<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ChevronRight, Layers, LayoutList, Plus } from '@lucide/vue';
import { http } from '../api/http';
import SettingsLayout from '../components/SettingsLayout.vue';
import EmptyState from '../components/EmptyState.vue';
import ListSkeleton from '../components/ListSkeleton.vue';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import DataCard from '../components/DataCard.vue';

// 預填模板一定屬於某一份表單（欄位就是那份表單的欄位），所以這頁以表單分組：
// 每份表單一張卡片、底下直接列出它的模板。早期版本把表單收在下拉選單裡，
// 使用者沒注意到要先選表單，也看不懂「（1 組）」在說什麼。
const route = useRoute();
const forms = ref([]);
const loading = ref(true);
const error = ref('');
const presetCount = computed(() => forms.value.reduce((sum, form) => sum + (form.presets?.length || 0), 0));

onMounted(async () => {
  try {
    const { data } = await http.get('/settings/form-templates');
    forms.value = Array.isArray(data) ? data : [];
    // 從填表頁「管理預填模板」帶 ?form= 過來時，捲到那份表單。
    const target = String(route.query.form ?? '');
    if (target) requestAnimationFrame(() => document.getElementById(`preset-form-${target}`)?.scrollIntoView({ block: 'start' }));
  } catch {
    error.value = '表單清單暫時無法載入，請稍後重試';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <SettingsLayout title="預填模板" description="每份健檢表單可以有幾組固定填法（例如預防針、牙齒），填報告時從頁首一鍵帶入。">
    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <ListSkeleton v-if="loading" :rows="4" :avatar="false" />
    <EmptyState v-else-if="!forms.length" :icon="Layers" title="還沒有健檢表單" description="先到「表單管理」建立一份表單，才能替它設定預填模板。" />

    <!-- 模板一定屬於某一份表單，所以以表單分組：表單是一列標頭，底下是它的模板。 -->
    <DataCard v-else title="各表單的模板" :count="presetCount">
      <section
        v-for="form in forms"
        :id="`preset-form-${form._id}`"
        :key="form._id"
        class="scroll-mt-24 border-b border-border last:border-b-0"
        :aria-labelledby="`preset-form-title-${form._id}`"
      >
        <header class="flex min-h-14 items-center gap-3 bg-sunken px-5 py-2" :class="String(route.query.form ?? '') === String(form._id) ? 'shadow-[inset_3px_0_0_var(--primary)]' : ''">
          <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"><LayoutList class="size-5" stroke-width="1.75" /></span>
          <h2 :id="`preset-form-title-${form._id}`" class="min-w-0 truncate text-base font-semibold">{{ form.name }}</h2>
          <span class="text-sm text-subtle-foreground"><span class="num">{{ form.presets?.length || 0 }}</span> 組</span>
          <Button as-child variant="secondary" size="sm" class="ml-auto">
            <router-link :to="`/settings/presets/${form._id}/new`"><Plus stroke-width="1.75" />新增模板</router-link>
          </Button>
        </header>
        <ul v-if="form.presets?.length" class="divide-y divide-border">
          <li v-for="preset in form.presets" :key="preset.key">
            <router-link :to="`/settings/presets/${form._id}/${preset.key}`" class="flex min-h-14 items-center gap-3 py-2 pr-5 pl-17 hover:bg-hover">
              <span class="min-w-0 flex-1 truncate font-semibold text-primary">{{ preset.name }}</span>
              <span class="text-sm text-subtle-foreground">設定 <span class="num">{{ preset.fieldCount }}</span> 欄</span>
              <ChevronRight class="size-5 shrink-0 text-subtle-foreground" stroke-width="1.75" />
            </router-link>
          </li>
        </ul>
        <p v-else class="py-3 pr-5 pl-17 text-sm text-subtle-foreground">還沒有模板</p>
      </section>
    </DataCard>
  </SettingsLayout>
</template>
