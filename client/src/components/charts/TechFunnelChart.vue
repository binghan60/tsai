<script setup>
import { computed } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import VChart from 'vue-echarts'
import { useTheme } from '../../composables/useTheme'

use([CanvasRenderer, BarChart, GridComponent, TooltipComponent])

const props = defineProps({
  data: { type: Array, default: () => [] },
})

const { isDark } = useTheme()
const palette = computed(() => isDark.value
  ? { steps: ['#88ccdd', '#56b9d2', '#30a3c0'], text: '#9aa5ad', tooltip: '#121b22', tooltipText: '#e9eef1', border: '#2c3a44' }
  : { steps: ['#54bfd4', '#19abc8', '#057c94'], text: '#6d665d', tooltip: '#ffffff', tooltipText: '#1f1b17', border: '#e0dad1' })

const option = computed(() => {
  const colors = palette.value
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: colors.tooltip,
      borderColor: colors.border,
      textStyle: { color: colors.tooltipText },
      formatter: '{b}：{c} 筆',
    },
    grid: { left: '2%', right: '14%', top: '4%', bottom: '4%', containLabel: true },
    xAxis: { type: 'value', show: false },
    yAxis: {
      type: 'category', inverse: true, data: props.data.map((item) => item.label),
      axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: colors.text, fontSize: 12 },
    },
    series: [{
      type: 'bar', barMaxWidth: 24, barCategoryGap: '35%',
      label: { show: true, position: 'right', color: colors.text, fontSize: 12 },
      data: props.data.map((item, index) => ({
        value: item.value,
        itemStyle: { color: colors.steps[index] ?? colors.steps.at(-1), borderRadius: [0, 4, 4, 0] },
      })),
    }],
  }
})
</script>

<template>
  <v-chart class="h-full min-h-[90px] w-full" :option="option" autoresize />
</template>
