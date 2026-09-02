<script setup>
import { computed } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import VChart from 'vue-echarts'
import { useTheme } from '../../composables/useTheme'

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent])

const props = defineProps({
  data: { type: Array, default: () => [] },
  label: { type: String, default: '服務量' },
})

const { isDark } = useTheme()
const palette = computed(() => {
  // Keep this dependency so ECharts refreshes after the root theme class changes.
  void isDark.value
  const styles = getComputedStyle(document.documentElement)
  const color = (token) => styles.getPropertyValue(token).trim()
  return {
    primary: color('--chart-1'),
    text: color('--muted-foreground'),
    grid: color('--border'),
    tooltip: color('--popover'),
    tooltipText: color('--popover-foreground'),
    area: color('--chart-area'),
  }
})

function labelFor(item) {
  if (item.label) return item.label
  const date = new Date(item.weekEnd ?? item.date)
  return Number.isNaN(date.getTime()) ? '' : `${date.getMonth() + 1}/${date.getDate()}`
}

const option = computed(() => {
  const colors = palette.value
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: colors.tooltip,
      borderColor: colors.grid,
      textStyle: { color: colors.tooltipText },
    },
    grid: { left: '3%', right: '4%', bottom: '3%', top: '8%', containLabel: true },
    xAxis: {
      type: 'category', boundaryGap: false, data: props.data.map(labelFor),
      axisLabel: { color: colors.text, fontSize: 12 }, axisLine: { lineStyle: { color: colors.grid } }, axisTick: { show: false },
    },
    yAxis: {
      type: 'value', minInterval: 1,
      axisLabel: { color: colors.text, fontSize: 12 }, axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { color: colors.grid, type: 'dashed' } },
    },
    series: [{
      name: props.label, type: 'line', smooth: true, showSymbol: false,
      data: props.data.map((item) => item.value ?? item.count ?? 0),
      lineStyle: { color: colors.primary, width: 2.5 },
      itemStyle: { color: colors.primary },
      areaStyle: { color: colors.area },
    }],
  }
})
</script>

<template>
  <v-chart class="h-full min-h-[120px] w-full" :option="option" autoresize />
</template>
