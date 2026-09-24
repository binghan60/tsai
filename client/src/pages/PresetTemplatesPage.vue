<script setup>
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Layers, Plus } from '@lucide/vue';
import { http } from '../api/http';
import SettingsLayout from '../components/SettingsLayout.vue';
import EmptyState from '../components/EmptyState.vue';
import ListSkeleton from '../components/ListSkeleton.vue';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';

// 預填模板一定屬於某一份表單（欄位就是那份表單的欄位），所以這頁以表單分組：
// 每份表單一張卡片、底下直接列出它的模板。早期版本把表單收在下拉選單裡，
// 使用者沒注意到要先選表單，也看不懂「（1 組）」在說什麼。
const route = useRoute();
const forms = ref([]);
const loading = ref(true);
const error = ref('');

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
  <SettingsLayout title="預填模板" description="每份健檢表單可以有幾組固定填法（例如預防針、牙齒），填寫報告時從頁首一鍵帶入；項目本身的預設值照舊會先帶入。">
    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <ListSkeleton v-if="loading" :rows="4" />
    <EmptyState v-else-if="!forms.length" :icon="Layers" title="還沒有健檢表單" description="先到「表單管理」建立一份表單，才能替它設定預填模板。" />

    <div v-else class="space-y-4">
      <Card
        v-for="form in forms"
        :id="`preset-form-${form._id}`"
        :key="form._id"
        class="scroll-mt-24 gap-3 p-5 shadow-sm"
        :class="String(route.query.form ?? '') === String(form._id) ? 'ring-2 ring-primary/40' : ''"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-0">
            <h2 class="truncate text-base font-semibold text-foreground">{{ form.name }}</h2>
            <p class="text-xs text-muted-foreground">{{ form.presets?.length ? `${form.presets.length} 組模板` : '還沒有模板' }}</p>
          </div>
          <Button as-child variant="secondary" size="sm">
            <router-link :to="`/settings/presets/${form._id}/new`"><Plus class="h-4 w-4" stroke-width="1.75" />新增模板</router-link>
          </Button>
        </div>
        <ul v-if="form.presets?.length" class="flex flex-wrap gap-2">
          <li v-for="preset in form.presets" :key="preset.key">
            <router-link
              :to="`/settings/presets/${form._id}/${preset.key}`"
              class="inline-flex min-h-10 items-center gap-2 rounded-lg bg-field px-3 text-sm font-medium text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {{ preset.name }}
              <span class="text-xs font-normal text-muted-foreground">{{ preset.fieldCount }} 欄</span>
            </router-link>
          </li>
        </ul>
      </Card>
    </div>
  </SettingsLayout>
</template>
