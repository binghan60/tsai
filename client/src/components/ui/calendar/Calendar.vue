<script setup>
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from '@lucide/vue';
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
    <!-- 外側兩顆是整年跳：貓咪生日這類年份差很多的日期，一個月一個月翻要按很久。
         真正差很遠的還是直接在 DatePicker 的輸入框打字比較快，這裡只是補一個中間檔。 -->
    <CalendarHeader class="flex items-center justify-between gap-1 pb-3">
      <div class="flex items-center gap-1">
        <CalendarPrev
          :prev-page="(date) => date.subtract({ years: 1 })"
          aria-label="前一年"
          class="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronsLeft class="h-4 w-4" stroke-width="1.75" />
        </CalendarPrev>
        <CalendarPrev
          class="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronLeft class="h-4 w-4" stroke-width="1.75" />
        </CalendarPrev>
      </div>
      <CalendarHeading class="text-base font-semibold text-foreground" />
      <div class="flex items-center gap-1">
        <CalendarNext
          class="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronRight class="h-4 w-4" stroke-width="1.75" />
        </CalendarNext>
        <CalendarNext
          :next-page="(date) => date.add({ years: 1 })"
          aria-label="後一年"
          class="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronsRight class="h-4 w-4" stroke-width="1.75" />
        </CalendarNext>
      </div>
    </CalendarHeader>

    <CalendarGrid v-for="month in grid" :key="month.value.toString()" class="w-full border-collapse select-none">
      <CalendarGridHead>
        <CalendarGridRow class="grid grid-cols-7">
          <CalendarHeadCell v-for="day in weekDays" :key="day" class="text-center text-xs font-medium text-subtle-foreground">{{ day }}</CalendarHeadCell>
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
                  'num mx-auto flex size-10 items-center justify-center rounded-lg text-sm text-foreground transition-colors hover:bg-hover',
                  // 今天：主色細框；選取：主色實心。兩者分開，才看得出「選的是不是今天」。
                  'data-[today]:font-semibold data-[today]:text-primary data-[today]:shadow-[inset_0_0_0_1.5px_var(--primary)]',
                  'data-[outside-view]:text-subtle-foreground/50',
                  'data-[selected]:bg-primary data-[selected]:font-semibold data-[selected]:text-primary-foreground data-[selected]:hover:bg-primary',
                  // 選的剛好是今天：上面兩組都是單一 data 變體，CSS 裡 today 排在 selected 後面，會把字蓋回主色、
                  // 跟主色底同色而整個看不見。疊兩個變體的選擇器比較具體，一定贏；細框改成白色，仍看得出是今天。
                  'data-[selected]:data-[today]:text-primary-foreground data-[selected]:data-[today]:shadow-[inset_0_0_0_2px_var(--primary),inset_0_0_0_3.5px_var(--primary-foreground)]',
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
