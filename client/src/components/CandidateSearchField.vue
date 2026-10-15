<script setup>
import { Search } from '@lucide/vue';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { useCandidateSearch } from '../composables/useCandidateSearch';

// 選一筆貓咪或飼主的搜尋欄：邊打邊查，清單點一下選定，選定後換成一張「更換」卡片。
// 現場加看、換飼主共用（掛號視窗那份是早期寫在元件裡的，同一個樣子）。
// 每一列與選定卡片的內容由使用端用 #item／#selected 插槽決定。
const props = defineProps({
  endpoint: { type: String, required: true },
  inputId: { type: String, required: true },
  emptyText: { type: String, default: '找不到符合的資料' },
  invalid: { type: Boolean, default: false },
});
const selected = defineModel({ type: Object, default: null });
const search = useCandidateSearch(props.endpoint);
</script>

<template>
  <div class="space-y-1.5">
    <div v-if="selected" class="flex items-center gap-3 rounded-lg border border-primary bg-accent px-3 py-2.5">
      <div class="min-w-0 flex-1 text-accent-foreground"><slot name="selected" :item="selected" /></div>
      <Button type="button" variant="secondary" size="sm" @click="selected = null">更換</Button>
    </div>
    <template v-else>
      <div class="relative">
        <Search class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" stroke-width="1.75" aria-hidden="true" />
        <Input :id="inputId" v-model="search.query.value" inputmode="search" class="pl-9" autocomplete="off" :aria-invalid="invalid" />
      </div>
      <div v-if="search.query.value.trim()" class="max-h-64 overflow-y-auto rounded-lg border border-border" aria-live="polite">
        <p v-if="search.loading.value" class="px-3 py-3 text-xs text-muted-foreground">搜尋中…</p>
        <p v-else-if="search.failed.value" class="px-3 py-3 text-xs text-destructive">搜尋失敗，請稍後再試</p>
        <p v-else-if="!search.results.value.length" class="px-3 py-3 text-xs text-muted-foreground">{{ emptyText }}</p>
        <button
          v-for="item in search.results.value"
          v-else
          :key="item._id"
          type="button"
          class="flex w-full items-center gap-3 border-b border-border bg-card px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-field"
          @click="selected = item"
        >
          <slot name="item" :item="item" />
        </button>
        <p v-if="search.hiddenCount.value" class="px-3 py-2.5 text-xs text-muted-foreground">還有 <span class="num">{{ search.hiddenCount.value }}</span> 筆沒列出，請多打幾個字縮小範圍。</p>
      </div>
    </template>
  </div>
</template>
