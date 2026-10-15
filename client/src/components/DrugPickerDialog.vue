<script setup>
import { computed, ref, watch } from 'vue';
import { Search, X } from '@lucide/vue';
import ModalDialog from './ModalDialog.vue';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { useDrugCabinet } from '../composables/useDrugCabinet';
import { groupDrugs, searchDrugs } from '../lib/drugGroups';
import RichText from './RichText.vue';
import { escapeRichText, richTextToPlain } from '../../../shared/richText.js';

// 勾選的藥可以各填劑量與頻率（每日幾次／每幾天一次），插入時接在藥名後面。
// 藥櫃視窗：左邊分類、右邊藥品，勾選後一次插入（依勾選順序）。勾選會跨分類、跨搜尋保留。
// 搜尋時右邊改列所有分類裡符合的藥品；沒有搜尋時「全部」列出每個分類（含分類標題）。
const emit = defineEmits(['close', 'confirm']);
const { drugs, groups } = useDrugCabinet();

const ALL = '__all__';
const sections = computed(() => groupDrugs(groups.value, drugs.value, { enabledOnly: true }).filter((section) => section.drugs.length));
const active = ref(ALL);
const keyword = ref('');
const selectedIds = ref([]); // 依勾選順序
const doses = ref({}); // 藥品 id → 劑量文字（取消勾選也留著，再勾回來還在）
const daily = ref({}); // 藥品 id → 每日幾次
const every = ref({}); // 藥品 id → 每幾天一次（跟每日幾次擇一，填一邊就清掉另一邊）

function setFrequency(id, kind, value) {
  const digits = String(value ?? '').replace(/\D/g, '').replace(/^0+/, '');
  daily.value = { ...daily.value, [id]: kind === 'daily' ? digits : '' };
  every.value = { ...every.value, [id]: kind === 'every' ? digits : '' };
}

// 目前選的分類被刪或清空（另一台改了）時退回「全部」。
watch(sections, (next) => {
  if (active.value !== ALL && !next.some((section) => String(section.id) === active.value)) active.value = ALL;
});

const sectionKey = (section) => String(section.id ?? 'none');
const totalCount = computed(() => sections.value.reduce((sum, section) => sum + section.drugs.length, 0));

const searching = computed(() => keyword.value.trim().length > 0);
const searchResults = computed(() => searchDrugs(sections.value.flatMap((section) => section.drugs), keyword.value));
const visibleSections = computed(() => {
  if (searching.value) return [];
  if (active.value === ALL) return sections.value;
  return sections.value.filter((section) => sectionKey(section) === active.value);
});

const selectedSet = computed(() => new Set(selectedIds.value));
function toggle(drug, checked) {
  if (checked) {
    if (!selectedSet.value.has(drug._id)) selectedIds.value = [...selectedIds.value, drug._id];
  } else {
    selectedIds.value = selectedIds.value.filter((id) => id !== drug._id);
  }
}

// 每個分類已勾選幾項（分類旁標示），「全部」是總數。
const selectedCounts = computed(() => {
  const counts = new Map();
  for (const section of sections.value) {
    counts.set(sectionKey(section), section.drugs.filter((drug) => selectedSet.value.has(drug._id)).length);
  }
  return counts;
});

function groupNameOf(drug) {
  return sections.value.find((section) => section.drugs.some((entry) => entry._id === drug._id))?.name ?? '';
}

// 已選的藥品，依勾選順序（也是插入順序）；藥品被刪或停用（另一台改了）時略過。
const selectedDrugs = computed(() => {
  const byId = new Map(drugs.value.map((drug) => [drug._id, drug]));
  return selectedIds.value.map((id) => byId.get(id)).filter((drug) => drug && drug.enabled !== false);
});

// 每種藥是否各插成獨立的一行（預設是）；關掉就全部接在游標處、以空白隔開。選擇記在這台裝置。
const NEWLINE_KEY = 'drug-picker-newline';
function readNewline() {
  try {
    return localStorage.getItem(NEWLINE_KEY) !== '0';
  } catch {
    return true;
  }
}
const newline = ref(readNewline());
watch(newline, (value) => {
  try {
    localStorage.setItem(NEWLINE_KEY, value ? '1' : '0');
  } catch {
    // 讀寫不到瀏覽器儲存也不影響使用
  }
});

function confirm() {
  const byId = new Map(drugs.value.map((drug) => [drug._id, drug]));
  // 劑量是純文字，接在藥名後面（跳脫後才不會被當成格式標記）。
  const picked = selectedIds.value
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((drug) => {
      const dose = (doses.value[drug._id] ?? '').trim();
      const times = daily.value[drug._id];
      const days = every.value[drug._id];
      const frequency = times ? `每日${times}次` : days ? (days === '1' ? '每天一次' : `每${days}天一次`) : '';
      const extra = [dose, frequency].filter(Boolean).join(' ');
      return extra ? { ...drug, name: `${drug.name} ${escapeRichText(extra)}` } : drug;
    });
  if (picked.length) emit('confirm', picked, { newline: newline.value });
  else emit('close');
}
</script>

<template>
  <ModalDialog size="xl" title="從藥櫃選擇" @close="emit('close')">
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="border-b border-border px-6 py-3">
        <label class="relative block">
          <span class="sr-only">搜尋藥品</span>
          <Search class="pointer-events-none absolute top-1/2 left-3 size-4.5 -translate-y-1/2 text-subtle-foreground" stroke-width="1.75" aria-hidden="true" />
          <Input v-model="keyword" class="pl-10" placeholder="搜尋藥品" autocomplete="off" />
        </label>
      </div>
      <div class="flex min-h-0 flex-1 flex-col md:h-144 md:flex-row">
        <nav class="flex shrink-0 gap-2 overflow-x-auto border-b border-border bg-sunken p-3 md:w-52 md:flex-col md:gap-1 md:overflow-y-auto md:border-r md:border-b-0" aria-label="藥品分類">
          <button
            type="button"
            class="flex h-11 shrink-0 items-center justify-between gap-3 rounded-lg px-3 text-left text-base whitespace-nowrap"
            :class="!searching && active === ALL ? 'bg-card font-semibold text-primary ring-1 ring-primary' : 'text-foreground hover:bg-hover'"
            @click="active = ALL; keyword = ''"
          >全部<span class="flex items-center gap-1.5"><span v-if="selectedIds.length" class="num inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground" :aria-label="`已選 ${selectedIds.length} 項`">{{ selectedIds.length }}</span><span class="num text-sm text-muted-foreground">{{ totalCount }}</span></span></button>
          <button
            v-for="section in sections"
            :key="sectionKey(section)"
            type="button"
            class="flex h-11 shrink-0 items-center justify-between gap-3 rounded-lg px-3 text-left text-base whitespace-nowrap"
            :class="!searching && active === sectionKey(section) ? 'bg-card font-semibold text-primary ring-1 ring-primary' : 'text-foreground hover:bg-hover'"
            @click="active = sectionKey(section); keyword = ''"
          >{{ section.name }}<span class="flex items-center gap-1.5"><span v-if="selectedCounts.get(sectionKey(section))" class="num inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground" :aria-label="`已選 ${selectedCounts.get(sectionKey(section))} 項`">{{ selectedCounts.get(sectionKey(section)) }}</span><span class="num text-sm text-muted-foreground">{{ section.drugs.length }}</span></span></button>
        </nav>

        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <ul v-if="searching" class="grid grid-cols-1 gap-1 lg:grid-cols-2">
            <li v-for="drug in searchResults" :key="drug._id">
              <label class="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-hover" :class="selectedSet.has(drug._id) ? 'bg-accent' : ''">
                <Checkbox :model-value="selectedSet.has(drug._id)" :aria-label="`選取${richTextToPlain(drug.name)}`" @update:model-value="toggle(drug, $event === true)" />
                <RichText :text="drug.name" tag="span" class="min-w-0 flex-1" />
                <span class="shrink-0 text-xs text-subtle-foreground">{{ groupNameOf(drug) }}</span>
              </label>
            </li>
          </ul>
          <template v-else>
            <section v-for="section in visibleSections" :key="sectionKey(section)" class="mb-3">
              <h3 v-if="active === ALL" class="px-3 pt-1 pb-1 text-sm font-semibold text-muted-foreground">{{ section.name }}<span class="num ml-2 font-normal">{{ section.drugs.length }}</span></h3>
              <ul class="grid grid-cols-1 gap-1 lg:grid-cols-2">
                <li v-for="drug in section.drugs" :key="drug._id">
                  <label class="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-hover" :class="selectedSet.has(drug._id) ? 'bg-accent' : ''">
                    <Checkbox :model-value="selectedSet.has(drug._id)" :aria-label="`選取${richTextToPlain(drug.name)}`" @update:model-value="toggle(drug, $event === true)" />
                    <RichText :text="drug.name" tag="span" class="min-w-0 flex-1" />
                  </label>
                </li>
              </ul>
            </section>
          </template>
        </div>
      </div>
      <!-- 已選：依勾選順序（＝插入順序），點 ✕ 取消；沒選時整條不出現。最多兩行高，超過在區內捲動。 -->
      <ul v-if="selectedDrugs.length" class="flex max-h-44 shrink-0 flex-col gap-1.5 overflow-y-auto border-t border-border bg-sunken px-6 py-2.5" aria-label="已選藥品">
        <li v-for="drug in selectedDrugs" :key="drug._id" class="flex items-center gap-2 rounded-lg bg-card py-1 pr-1 pl-2.5 text-sm ring-1 ring-border">
          <RichText :text="drug.name" tag="span" one-line class="min-w-0 flex-1" v-tip.overflow="richTextToPlain(drug.name)" />
          <Input v-model="doses[drug._id]" class="h-8 w-40 shrink-0" maxlength="100" placeholder="劑量" autocomplete="off" :aria-label="`${richTextToPlain(drug.name)}的劑量`" />
          <span class="flex shrink-0 items-center gap-1 whitespace-nowrap">每日<Input :model-value="daily[drug._id] ?? ''" class="num h-8 w-14 px-2 text-center" placeholder="2" inputmode="numeric" maxlength="2" autocomplete="off" :aria-label="`${richTextToPlain(drug.name)}每日幾次`" @update:model-value="setFrequency(drug._id, 'daily', $event)" />次</span>
          <span class="flex shrink-0 items-center gap-1 whitespace-nowrap">每<Input :model-value="every[drug._id] ?? ''" class="num h-8 w-14 px-2 text-center" placeholder="2" inputmode="numeric" maxlength="2" autocomplete="off" :aria-label="`${richTextToPlain(drug.name)}每幾天一次`" @update:model-value="setFrequency(drug._id, 'every', $event)" />天一次</span>
          <button type="button" class="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle-foreground hover:bg-hover hover:text-foreground" :aria-label="`取消選取${richTextToPlain(drug.name)}`" @click="toggle(drug, false)"><X class="size-4" stroke-width="1.75" /></button>
        </li>
      </ul>
      <div class="flex shrink-0 items-center gap-2 border-t border-border px-6 py-4">
        <label class="mr-auto flex cursor-pointer items-center gap-2 text-base">
          <Checkbox :model-value="newline" aria-label="每種藥換行" @update:model-value="newline = $event === true" />每種藥換行
        </label>
        <Button type="button" variant="secondary" @click="emit('close')">取消</Button>
        <Button type="button" :disabled="!selectedIds.length" @click="confirm">{{ selectedIds.length ? `插入 ${selectedIds.length} 項` : '插入' }}</Button>
      </div>
    </div>
  </ModalDialog>
</template>
