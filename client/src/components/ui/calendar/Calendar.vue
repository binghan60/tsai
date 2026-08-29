<script setup>
import { ChevronLeft, ChevronRight } from '@lucide/vue';
import {
  CalendarCell,
  CalendarCellTrigger,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHead,
  CalendarGridRow,
  CalendarHeadCell,
  CalendarHeader,
  CalendarHeading,
  CalendarNext,
  CalendarPrev,
  CalendarRoot,
} from 'reka-ui';
import { cn } from '@/lib/utils';

// 只有 DatePicker 一個使用端，不照 shadcn 慣例把每個 reka-ui 子元件都拆成獨立檔案——
// 那是給要在很多地方重組版面的情境用的，這裡直接在同一個檔案排版即可。
const props = defineProps({
  modelValue: { type: null, required: false },
  placeholder: { type: null, required: false },
  minValue: { type: null, required: false },
  maxValue: { type: null, required: false },
});
const emit = defineEmits(['update:modelValue', 'update:placeholder']);
</script>

<template>
  <CalendarRoot
    v-slot="{ grid, weekDays }"
    :model-value="props.modelValue"
    :placeholder="props.placeholder"
    :min-value="props.minValue"
    :max-value="props.maxValue"
    class="w-full"
    @update:model-value="emit('update:modelValue', $event)"
    @update:placeholder="emit('update:placeholder', $event)"
  >
    <CalendarHeader class="flex items-center justify-between pb-3">
      <CalendarPrev
        class="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-muted/60 text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
      >
        <ChevronLeft class="h-4 w-4" stroke-width="1.75" />
      </CalendarPrev>
      <CalendarHeading class="text-sm font-semibold text-foreground" />
      <CalendarNext
        class="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-muted/60 text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
      >
        <ChevronRight class="h-4 w-4" stroke-width="1.75" />
      </CalendarNext>
    </CalendarHeader>

    <CalendarGrid v-for="month in grid" :key="month.value.toString()" class="w-full border-collapse select-none">
      <CalendarGridHead>
        <CalendarGridRow class="grid grid-cols-7">
          <CalendarHeadCell v-for="day in weekDays" :key="day" class="text-center text-xs font-medium text-muted-foreground">{{ day }}</CalendarHeadCell>
        </CalendarGridRow>
      </CalendarGridHead>
      <CalendarGridBody>
        <CalendarGridRow v-for="(weekDates, index) in month.rows" :key="`week-${index}`" class="mt-1 grid grid-cols-7">
          <CalendarCell v-for="weekDate in weekDates" :key="weekDate.toString()" :date="weekDate" class="p-0 text-center">
            <CalendarCellTrigger
              :day="weekDate"
              :month="month.value"
              :class="
                cn(
                  'mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-muted/40 text-sm text-foreground transition-colors hover:bg-muted',
                  'data-[today]:font-semibold data-[today]:text-primary dark:data-[today]:text-primary',
                  'data-[outside-view]:text-muted-foreground/50',
                  'data-[selected]:bg-primary data-[selected]:text-primary-foreground data-[selected]:hover:bg-primary',
                  'data-[today]:data-[selected]:text-primary-foreground',
                  'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
                  'data-[unavailable]:pointer-events-none data-[unavailable]:text-muted-foreground/40 data-[unavailable]:line-through',
                )
              "
            />
          </CalendarCell>
        </CalendarGridRow>
      </CalendarGridBody>
    </CalendarGrid>
  </CalendarRoot>
</template>
