<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Zap } from '@lucide/vue';
import { http } from '../../api/http';
import { useRecordForm } from './context';

const props = defineProps({
  modelValue: { type: [String, null], default: '' },
  label: { type: String, required: true },
});
const emit = defineEmits(['update:modelValue']);

const { preview } = useRecordForm();
const root = ref(null);
const open = ref(false);
const openUp = ref(false);
const items = ref([]);
const normalizedLabel = computed(() => props.label.trim().toLocaleLowerCase());
const selectedContents = computed(() => new Set(
  String(props.modelValue ?? '').split('\n').map((entry) => entry.trim()).filter(Boolean)
));

function closeWhenOutside(event) {
  if (!root.value?.contains(event.target)) open.value = false;
}
function toggleOpen() {
  if (!open.value) {
    const rect = root.value?.getBoundingClientRect();
    const requiredHeight = 290;
    openUp.value = Boolean(rect && window.innerHeight - rect.bottom < requiredHeight && rect.top > requiredHeight);
  }
  open.value = !open.value;
}
function isSelected(item) {
  return selectedContents.value.has(item.content.trim());
}
function toggle(item) {
  const content = item.content.trim();
  const lines = String(props.modelValue ?? '').split('\n');
  const next = isSelected(item)
    ? lines.filter((line) => line.trim() !== content)
    : [...lines.filter((line) => line.trim()), content];
  emit('update:modelValue', next.join('\n'));
}

onMounted(async () => {
  try {
    const { data } = await http.get('/quick-menus');
    const menu = (data ?? []).find((entry) => entry.name.trim().toLocaleLowerCase() === normalizedLabel.value);
    items.value = (menu?.items ?? []).filter((item) => item.enabled !== false);
  } catch {
    items.value = [];
  }
  document.addEventListener('pointerdown', closeWhenOutside);
});
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeWhenOutside));
</script>

<template>
  <div v-if="!preview && items.length" ref="root" class="absolute right-2 top-11 z-10">
    <button
      type="button"
      class="inline-flex size-7 items-center justify-center rounded-md border border-border/80 bg-background/90 text-primary shadow-sm backdrop-blur-sm transition-colors hover:border-primary/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      :aria-expanded="open"
      :aria-label="`開啟${label}快捷選單`"
      :title="`開啟${label}快捷選單`"
      @click="toggleOpen"
    >
      <Zap class="h-3.5 w-3.5" stroke-width="1.75" />
    </button>
    <div v-if="open" class="absolute right-0 w-80 rounded-lg border border-border bg-popover p-2 shadow-lg" :class="openUp ? 'bottom-full mb-1' : 'top-full mt-1'">
      <p class="px-2 pb-1 text-xs text-muted-foreground">可複選，選取內容會逐行帶入欄位。</p>
      <div class="max-h-56 overflow-y-auto">
        <label v-for="item in items" :key="item._id" class="flex min-h-10 cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-sm text-foreground hover:bg-muted">
          <input type="checkbox" class="mt-0.5 size-4 shrink-0 accent-primary" :checked="isSelected(item)" @change="toggle(item)" />
          <span class="line-clamp-2">{{ item.content }}</span>
        </label>
      </div>
    </div>
  </div>
</template>
