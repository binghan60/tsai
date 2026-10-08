<script setup>
import { ref } from 'vue'
import { ArrowRight } from '@lucide/vue'
import { useLabFillStatus } from '../composables/useLabFillStatus'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

// IDEXX 檢驗結果的「填入狀態」燈號：這次看診連到的結果，哪些數值進了健檢報告、哪些沒進（規則在 lib/labFillStatus.js）。
// 匯入當下的 toast 只講一次，這裡隨時查得到：一顆燈＋一句摘要，點開是每台儀器的明細。
// 診療台「檢驗報告」標題旁與健檢報告填寫頁「引用本次看診」共用。沒有連到這次看診的結果就整個不畫。
// 「比對」由使用端開 LabConflictDialog（健檢報告填寫頁處理完還要同步畫面上的值）。
const props = defineProps({
  petId: { type: String, default: '' },
  appointmentId: { type: String, default: '' },
  // 看診那一天：當天驗的只寫時間，別天匯入的連日期一起寫。
  baseDate: { type: String, default: '' },
  // 看診的 __v：變了就重讀。
  version: { type: Number, default: 0 },
})
const emit = defineEmits(['compare'])
const { status, reload } = useLabFillStatus(() => props)
const open = ref(false)

const LIGHTS = { success: 'bg-success', warning: 'bg-warning', info: 'bg-info' }
// 未對應的紀錄是「檢驗別・代號」；明細已經一台儀器一段，只留代號。
const codeOf = (label) => String(label).split('・').pop()

function compare(group) {
  open.value = false
  emit('compare', group)
}

defineExpose({ reload })
</script>

<template>
  <Popover v-if="status.tone" v-model:open="open">
    <PopoverTrigger as-child>
      <Button type="button" variant="secondary" size="sm" class="gap-2" :aria-label="`健檢報告填入狀態：${status.text}`">
        <span class="size-2.5 shrink-0 rounded-full" :class="LIGHTS[status.tone]" aria-hidden="true"></span>{{ status.text }}
      </Button>
    </PopoverTrigger>
    <PopoverContent class="max-h-[70vh] w-[26rem] max-w-[calc(100vw-2rem)] space-y-4 overflow-y-auto p-4">
      <h4 class="text-base font-semibold">健檢報告填入狀態</h4>
      <section v-for="section in status.sections" :key="section.id" class="space-y-2.5 border-t border-border pt-3" :aria-label="`${section.title} ${section.time}`">
        <p class="flex items-baseline gap-2 text-sm font-semibold">
          {{ section.title }}<span class="num text-xs font-normal text-subtle-foreground">{{ section.time }}</span>
        </p>
        <p v-if="section.noTemplate" class="rounded-lg bg-warning-surface px-3 py-2 text-sm text-warning">這次看診沒有選健檢表單</p>
        <p v-if="section.finalized" class="rounded-lg bg-warning-surface px-3 py-2 text-sm text-warning">填入時健檢報告已經結案</p>

        <div v-if="section.conflicts.length" class="space-y-1.5 rounded-lg bg-warning-surface px-3 py-2">
          <p class="flex items-center gap-2 text-xs font-medium text-warning">
            跟報告不同<span class="num">{{ section.conflicts.length }}</span>
            <Button type="button" variant="soft" size="xs" class="ml-auto" @click="compare(section.group)">比對</Button>
          </p>
          <ul class="text-sm">
            <li v-for="item in section.conflicts" :key="item.key" class="grid grid-cols-[minmax(0,1fr)_auto_1rem_auto] items-baseline gap-x-2 py-0.5">
              <span class="truncate" v-tip.overflow="item.label">{{ item.label }}</span>
              <span class="num text-muted-foreground">{{ item.current }}</span>
              <ArrowRight class="size-3.5 self-center text-subtle-foreground" stroke-width="1.75" aria-hidden="true" />
              <span class="num font-semibold">{{ item.idexx }}</span>
            </li>
          </ul>
        </div>

        <div v-if="section.filled.length" class="space-y-1">
          <p class="text-xs font-medium text-success">已填入<span class="num ml-2">{{ section.filled.length }}</span></p>
          <ul class="grid grid-cols-2 gap-x-4 text-sm">
            <li v-for="item in section.filled" :key="item.key" class="flex items-baseline justify-between gap-2 py-0.5">
              <span class="truncate" v-tip.overflow="item.label">{{ item.label }}</span><span class="num shrink-0 font-semibold">{{ item.value }}</span>
            </li>
          </ul>
        </div>

        <div v-if="section.unmapped.length" class="space-y-1">
          <p class="text-xs font-medium text-muted-foreground">報告上沒有這個欄位<span class="num ml-2">{{ section.unmapped.length }}</span></p>
          <p class="num text-sm text-muted-foreground">{{ section.unmapped.map(codeOf).join('、') }}</p>
        </div>
      </section>
    </PopoverContent>
  </Popover>
</template>
