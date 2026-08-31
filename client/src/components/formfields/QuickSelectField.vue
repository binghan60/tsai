<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ChevronDown, Zap } from '@lucide/vue';
import { http } from '../../api/http';
import FieldShell from './FieldShell.vue';
import { Input } from '../ui/input';

const props = defineProps({ item: { type: Object, required: true }, modelValue: { type: [String, null], default: '' } });
const emit = defineEmits(['update:modelValue']);
const inputId = computed(() => `record-${props.item.key}`);
const root = ref(null); const input = ref(null); const items = ref([]); const open = ref(false); const all = ref(false); const active = ref(-1);
const matches = computed(() => { const q = String(props.modelValue ?? '').trim().toLocaleLowerCase(); return (all.value || !q ? items.value : items.value.filter((item) => item.content.toLocaleLowerCase().includes(q))).slice(0, 80); });
function update(value) { emit('update:modelValue', value); open.value = true; all.value = false; active.value = -1; }
function choose(item) { emit('update:modelValue', item.content); open.value = false; active.value = -1; requestAnimationFrame(() => input.value?.focus()); }
function keys(event) { if (event.key === 'ArrowDown') { event.preventDefault(); open.value = true; active.value = Math.min(active.value + 1, matches.value.length - 1); } else if (event.key === 'ArrowUp') { event.preventDefault(); active.value = Math.max(active.value - 1, 0); } else if (event.key === 'Enter' && open.value && active.value >= 0) { event.preventDefault(); choose(matches.value[active.value]); } else if (event.key === 'Escape') open.value = false; }
function outside(event) { if (!root.value?.contains(event.target)) open.value = false; }
onMounted(async () => { try { const { data } = await http.get('/quick-menus'); const menu = (data ?? []).find((entry) => entry._id === props.item.quickMenuId); items.value = (menu?.items ?? []).filter((item) => item.enabled !== false); } catch { items.value = []; } document.addEventListener('pointerdown', outside); });
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside));
</script>
<template><FieldShell :item="item" :input-id="inputId"><div ref="root" class="relative"><Input :id="inputId" ref="input" :model-value="modelValue" type="text" autocomplete="off" :placeholder="item.placeholder || '輸入搜尋或展開快捷選單'" class="pr-11" role="combobox" :aria-expanded="open" @update:model-value="update" @focus="open = true; all = false" @keydown="keys" /><button type="button" class="absolute inset-y-0 right-0 flex min-h-10 w-10 items-center justify-center rounded-r-xl text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="展開快捷選單" @mousedown.prevent @click="all = true; open = true; active = -1"><ChevronDown class="h-4 w-4" /></button><div v-if="open" class="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"><button v-for="(entry, index) in matches" :key="entry._id" type="button" class="flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm" :class="index === active ? 'bg-muted' : 'hover:bg-muted'" @mousedown.prevent="choose(entry)"><Zap class="h-4 w-4 shrink-0 text-primary" /><span class="truncate font-medium text-foreground">{{ entry.content }}</span></button><p v-if="!matches.length" class="px-2 py-3 text-sm text-muted-foreground">沒有可用項目，可直接輸入。</p></div></div></FieldShell></template>
