<script setup>
import { CircleAlert } from '@lucide/vue';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

defineProps({
  text: { type: String, required: true },
  label: { type: String, default: '查看資料連動說明' },
});
</script>

<template>
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger as-child>
        <button
          type="button"
          class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-warning transition-colors hover:text-warning/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="label"
        >
          <CircleAlert class="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" class="max-w-sm whitespace-normal leading-relaxed">
        {{ text }}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
