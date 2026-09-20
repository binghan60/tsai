<script setup>
// ConsoleChip 的軌道。把頁首那幾顆開面板的按鈕收成「一組」而不是散落的幾顆——
// 之前查閱清單、待辦工作台、建立動作三種層級的按鈕混在同一列、長得一模一樣，
// 這條 muted 底的膠囊就是把前兩者圈起來、跟右邊的主要動作分開的那條線。
//
// 群內要再分「查閱」與「待辦」時，使用端自己插一條分隔線：
//   <span class="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
defineProps({
  ariaLabel: { type: String, required: true },
});
</script>

<template>
  <!-- 刻意不給 overflow-x-auto：放不下時橫向捲動等於把 chip 連同它的數字默默裁掉，
       桌機上也沒有人會想到去捲一條工具列，畫面上完全看不出少了東西。
       改成 max-w-full + flex-wrap：擠不下就在軌道內換行，看得見、也不會讓頁面長出橫向捲動
       （手機上整條 chip 群本來就比螢幕寬）。
       rounded-3xl 是 24px：單行時軌道正好 48px 高，看起來就是個膠囊；換行時才成為圓角矩形。 -->
  <div role="group" :aria-label="ariaLabel" class="inline-flex max-w-full flex-wrap items-center gap-1 rounded-3xl bg-muted p-1.5">
    <slot />
  </div>
</template>
