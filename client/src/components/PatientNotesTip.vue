<script setup>
import { computed } from 'vue'
import { AlertTriangle } from '@lucide/vue'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

// 寵物／飼主備註的精簡版：一顆「注意／提醒」小標籤，滑過去才看全文。
// 給高度固定的地方用（診療台精簡卡片、面板裡的清單列）——常駐版 PatientNotes 會把列撐高。
// 備註提到咬人、兇就用「注意」，其餘是「提醒」。
const props = defineProps({
  // patientNotesFor() 的回傳：[{ key, label, text }]
  notes: { type: Array, default: () => [] },
})

const severe = computed(() => props.notes.some((note) => note.text.includes('咬') || note.text.includes('凶')))
</script>

<template>
  <TooltipProvider v-if="notes.length" :delay-duration="100">
    <Tooltip>
      <TooltipTrigger as-child>
        <button
          type="button"
          class="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded bg-warning-surface px-1.5 py-0.5 text-[11px] font-semibold text-warning transition-colors hover:bg-warning/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-warning"
          :aria-label="`${severe ? '注意' : '提醒'}備註：${notes.map((note) => note.text).join('；')}`"
          @click.stop
        >
          <AlertTriangle class="h-3 w-3" stroke-width="2" aria-hidden="true" />
          <span>{{ severe ? '注意' : '提醒' }}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" :arrow="false" class="flex max-w-xs flex-col gap-1.5 rounded-xl border border-border bg-popover p-2 whitespace-normal text-popover-foreground shadow-lg">
        <div v-for="note in notes" :key="note.key" class="rounded-md bg-warning-surface px-2.5 py-1.5 text-xs leading-relaxed font-medium whitespace-pre-wrap break-words text-warning">
          <span class="font-semibold">{{ note.label }}備註：</span>{{ note.text }}
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
