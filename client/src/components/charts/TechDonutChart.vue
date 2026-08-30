<script setup>
import { computed } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { PieChart } from 'echarts/charts'
import { TooltipComponent, LegendComponent } from 'echarts/components'
import VChart from 'vue-echarts'
import { useTheme } from '../../composables/useTheme'

use([CanvasRenderer, PieChart, TooltipComponent, LegendComponent])

const props = defineProps({
  data: { type: Array, default: () => [] },
  name: { type: String, default: '預約轉換' },
})

const { isDark } = useTheme()
const palette = computed(() => isDark.value
  ? { text: '#9aa5ad', border: '#121b22', tooltip: '#121b22', tooltipText: '#e9eef1', colors: ['#3e93a6', '#d6ae62', '#5caa7b'] }
  : { text: '#6d665d', border: '#ffffff', tooltip: '#ffffff', tooltipText: '#1f1b17', colors: ['#0e5a6b', '#a87318', '#317c50'] })

const option = computed(() => {
  const colors = palette.value
  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item', backgroundColor: colors.tooltip, borderColor: colors.border, textStyle: { color: colors.tooltipText }, formatter: '{a}<br />{b}：{c} ({d}%)' },
    legend: { orient: 'vertical', right: '4%', top: 'center', textStyle: { color: colors.text } },
    series: [{
      name: props.name, type: 'pie', radius: ['48%', '74%'], center: ['38%', '50%'], avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: colors.border, borderWidth: 2 },
      label: { show: false }, labelLine: { show: false }, color: colors.colors,
      data: props.data.map((item) => ({ name: item.label, value: item.value })),
    }],
  }
})
</script>

<template>
  <v-chart class="h-full min-h-[120px] w-full" :option="option" autoresize />
</template>
