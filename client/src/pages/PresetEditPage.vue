<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { Save, Trash2 } from '@lucide/vue';
import { http } from '../api/http';
import { useFormTemplate } from '../composables/useFormTemplate';
import { useToast } from '../composables/useToast';
import Breadcrumbs from '../components/Breadcrumbs.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import ListSkeleton from '../components/ListSkeleton.vue';
import PresetValuesEditor from '../components/formfields/PresetValuesEditor.vue';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

// 一次編輯一組預填模板。presetKey 是 'new' 時為新增，存檔後網址換成正式 key。
// 模板存在表單文件裡（FormTemplate.presets），存檔送的是整份表單的模板清單，
// 這裡只換掉自己那一組，其他組照伺服器上的原樣送回去。
const route = useRoute();
const router = useRouter();
const toast = useToast();
const { clearTemplateCache } = useFormTemplate();

const template = ref(null);
const presetKey = ref('');
const name = ref('');
const values = ref({});
const savedSnapshot = ref('');
const loading = ref(true);
const saving = ref(false);
const deleting = ref(false);
const showDeleteConfirm = ref(false);
const error = ref('');

const isNew = computed(() => presetKey.value === 'new');
const formName = computed(() => template.value?.name ?? '健檢表單');
const snapshot = () => JSON.stringify({ name: name.value, values: values.value });
const isDirty = computed(() => Boolean(template.value) && snapshot() !== savedSnapshot.value);

function markSaved() {
  savedSnapshot.value = snapshot();
}

async function load() {
  const formId = String(route.params.formId);
  const key = String(route.params.presetKey);
  loading.value = true;
  error.value = '';
  try {
    const { data } = await http.get(`/settings/form-templates/${formId}`);
    template.value = data;
    presetKey.value = key;
    const preset = key === 'new' ? null : (data.presets ?? []).find((entry) => entry.key === key);
    if (key !== 'new' && !preset) {
      error.value = '找不到這組預填模板，可能已被刪除。';
      template.value = null;
      return;
    }
    name.value = preset?.name ?? '';
    values.value = { ...(preset?.values ?? {}) };
    markSaved();
  } catch (err) {
    error.value = err.response?.status === 404 ? '找不到這份表單' : '表單內容暫時無法載入，請稍後重試';
  } finally {
    loading.value = false;
  }
}

// 存檔後把 new 換成正式 key 是同一條路由的參數變化，不重新載入；
// 只有真的換到另一組（例如瀏覽器上一頁）才重讀。
watch(() => [route.params.formId, route.params.presetKey], ([formId, key]) => {
  if (!formId || !key) return;
  if (String(formId) === String(template.value?._id ?? '') && String(key) === presetKey.value) return;
  load();
});

function validate() {
  const trimmed = name.value.trim();
  if (!trimmed) return '請輸入模板名稱。';
  const clash = (template.value?.presets ?? []).some((preset) => preset.key !== presetKey.value && preset.name === trimmed);
  return clash ? `「${formName.value}」已經有一組叫「${trimmed}」的模板。` : '';
}

async function putPresets(presets) {
  const { data } = await http.put(`/settings/form-templates/${template.value._id}`, {
    presets,
    expectedVersion: template.value.documentVersion ?? 0,
  });
  template.value = data;
  clearTemplateCache();
  return data;
}

async function save() {
  if (!template.value || saving.value) return;
  error.value = validate();
  if (error.value) return;
  saving.value = true;
  const trimmed = name.value.trim();
  const others = template.value.presets ?? [];
  const next = isNew.value
    ? [...others, { name: trimmed, values: values.value }]
    : others.map((preset) => (preset.key === presetKey.value ? { ...preset, name: trimmed, values: values.value } : preset));
  try {
    const data = await putPresets(next);
    const saved = (data.presets ?? []).find((preset) => preset.name === trimmed);
    name.value = saved?.name ?? trimmed;
    values.value = { ...(saved?.values ?? {}) };
    markSaved();
    if (isNew.value && saved) {
      presetKey.value = saved.key;
      router.replace(`/settings/presets/${data._id}/${saved.key}`);
    }
    toast.success(`用「${formName.value}」填寫報告時，就能在頁首套用。`, `「${name.value}」已儲存`);
  } catch (err) {
    error.value = err.response?.data?.message ?? '預填模板儲存失敗，請稍後再試。';
    toast.error(error.value, '儲存失敗');
  } finally {
    saving.value = false;
  }
}

async function confirmDelete() {
  if (!template.value || deleting.value) return;
  deleting.value = true;
  try {
    await putPresets((template.value.presets ?? []).filter((preset) => preset.key !== presetKey.value));
    markSaved();
    showDeleteConfirm.value = false;
    toast.success(`已從「${formName.value}」移除。`, `「${name.value}」已刪除`);
    router.push({ path: '/settings/presets', query: { form: template.value._id } });
  } catch (err) {
    error.value = err.response?.data?.message ?? '刪除失敗，請稍後再試。';
    toast.error(error.value, '刪除失敗');
  } finally {
    deleting.value = false;
  }
}

// 未儲存提示，做法同表單設計頁。
function warnBeforeUnload(event) {
  if (!isDirty.value) return;
  event.preventDefault();
  event.returnValue = '';
}
onMounted(() => {
  load();
  window.addEventListener('beforeunload', warnBeforeUnload);
});
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnBeforeUnload));

const leaveResolve = ref(null);
onBeforeRouteLeave(() => {
  if (!isDirty.value) return true;
  return new Promise((resolve) => { leaveResolve.value = resolve; });
});
function resolveLeave(confirmed) {
  const resolve = leaveResolve.value;
  leaveResolve.value = null;
  resolve?.(confirmed);
}
</script>

<template>
  <section class="space-y-5 pb-10">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <Breadcrumbs
          class="mb-2"
          :items="[
            { label: '預填模板', to: { path: '/settings/presets', query: template ? { form: template._id } : undefined } },
            { label: formName },
            { label: isNew ? '新增模板' : (name.trim() || '未命名模板') },
          ]"
        />
        <div class="flex min-w-0 items-center gap-3">
          <h1 class="truncate text-xl font-semibold text-foreground">{{ isNew ? '新增預填模板' : (name.trim() || '未命名模板') }}</h1>
          <Badge v-if="template && !isNew" :variant="isDirty ? 'secondary' : 'outline'" :class="isDirty ? 'shrink-0 text-warning' : 'shrink-0 text-muted-foreground'">{{ isDirty ? '尚未儲存' : '已儲存' }}</Badge>
        </div>
        <p class="mt-1 text-sm text-muted-foreground">屬於「{{ formName }}」表單，只有用這份表單填寫報告時才會出現。</p>
      </div>
      <div v-if="template" class="flex flex-wrap items-center gap-2">
        <Button v-if="!isNew" type="button" variant="destructive" :disabled="saving || deleting" @click="showDeleteConfirm = true"><Trash2 class="h-4 w-4" stroke-width="1.75" />刪除模板</Button>
        <Button type="button" :disabled="saving || deleting || (!isNew && !isDirty)" @click="save"><Save class="h-4 w-4" stroke-width="1.75" />{{ saving ? '儲存中…' : isNew ? '建立模板' : '儲存變更' }}</Button>
      </div>
    </header>

    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <ListSkeleton v-if="loading" :rows="5" />

    <template v-else-if="template">
      <div class="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div class="max-w-md space-y-1.5">
          <Label for="preset-name" class="text-xs font-medium">模板名稱<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
          <Input id="preset-name" v-model="name" placeholder="例如：預防針" />
        </div>
        <p class="mt-3 text-xs text-muted-foreground">只填這組模板要帶入的欄位；留空的欄位套用時不會被覆寫，維持預設值或醫師已填的內容。獸醫師、日期，以及理學檢查、檢驗、量測、牙齒圖與圖片每次看診都不一樣，不在模板範圍內。</p>
      </div>

      <PresetValuesEditor v-model:values="values" :sections="template.sections ?? []" />
    </template>

    <ConfirmDialog
      :open="showDeleteConfirm"
      title="刪除這組預填模板？"
      :description="`「${name.trim() || '未命名模板'}」會從「${formName}」移除。已經套用過的報告內容不受影響。`"
      confirm-label="刪除模板"
      destructive
      :loading="deleting"
      @update:open="(open) => !open && (showDeleteConfirm = false)"
      @confirm="confirmDelete"
    />
    <ConfirmDialog
      :open="Boolean(leaveResolve)"
      title="尚有未儲存的變更"
      description="離開這一頁會捨棄剛才對這組模板的修改，這個動作無法復原。"
      confirm-label="捨棄變更並離開"
      cancel-label="留在此頁"
      destructive
      @update:open="(open) => !open && resolveLeave(false)"
      @confirm="resolveLeave(true)"
    />
  </section>
</template>
