<script setup>
import { Search } from '@lucide/vue';
import { NAV_GROUPS } from '../../lib/navigation';
import { useStaffIdentity } from '../../composables/useStaffIdentity';
import AppSettingsMenu from '../AppSettingsMenu.vue';

defineProps({
  isActive: { type: Function, required: true },
});
const emit = defineEmits(['search', 'logout']);
const { identity } = useStaffIdentity();
</script>

<template>
  <!-- 視窗矮的時候（short：高度 959px 以下）項目從 52 縮成 48、分組小標收起來（分隔線還在）、間距縮小；再矮也放不下時中間的選單區自己捲動，
       Logo、搜尋釘在上面，設定、身分釘在下面——以前整條是一根不捲動的柱子，1080p 螢幕開著瀏覽器時「設定」就被推出畫面。 -->
  <nav aria-label="主選單" class="flex h-full w-18 shrink-0 flex-col items-center border-r border-nav-border bg-nav py-3 short:py-2">
    <router-link to="/" aria-label="謙華動物醫院首頁" class="mb-2 flex h-11 w-14 shrink-0 items-center justify-center rounded-[10px] transition-colors hover:bg-hover short:mb-1 short:h-10">
      <img src="/chien-hua-logo-mark-v2.png" alt="" aria-hidden="true" class="h-9 w-12 object-contain" />
    </router-link>
    <button type="button" aria-label="搜尋（Ctrl K）" class="flex h-13 w-15 shrink-0 flex-col items-center justify-center gap-1 rounded-[10px] text-nav-foreground transition-colors hover:bg-hover short:h-12" @click="emit('search')">
      <Search class="size-5" stroke-width="1.75" />
      <span class="text-2xs leading-none font-medium">搜尋</span>
    </button>

    <!-- 分組標題曾經只是跟項目同字級的淡色字，看起來像少了圖示的項目、分不出段落。
         現在每組前面一條分隔線（第一組也要，跟「搜尋」隔開），標題用下凹底的小膠囊，形狀跟項目不同。 -->
    <div class="flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto overscroll-contain [scrollbar-width:thin]">
    <template v-for="group in NAV_GROUPS" :key="group.label">
      <span class="mt-2 mb-2.5 block h-px w-12 shrink-0 bg-nav-border short:mt-1 short:mb-1.5" aria-hidden="true"></span>
      <div class="flex flex-col items-center gap-0.5" role="group" :aria-label="group.label">
        <span class="mb-1 inline-flex h-5 shrink-0 items-center rounded-full bg-sunken px-2 text-2xs short:hidden leading-none font-semibold text-nav-label shadow-[inset_0_0_0_1px_var(--border)]" aria-hidden="true">{{ group.label }}</span>
        <router-link
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="flex h-13 w-15 shrink-0 flex-col items-center justify-center gap-1 rounded-[10px] transition-colors short:h-12"
          :class="isActive(item) ? 'bg-nav-active text-nav-active-foreground dark:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--nav-active-foreground)_35%,transparent)]' : 'text-nav-foreground hover:bg-hover'"
          :aria-current="isActive(item) ? 'page' : undefined"
        >
          <component :is="item.icon" class="size-5" :stroke-width="isActive(item) ? 2 : 1.75" />
          <span class="text-2xs leading-none" :class="isActive(item) ? 'font-semibold' : 'font-medium'">{{ item.label }}</span>
        </router-link>
      </div>
    </template>
    </div>

    <AppSettingsMenu rail class="mt-1 shrink-0" @logout="emit('logout')" />
    <span class="mt-1.5 inline-flex h-6 shrink-0 items-center rounded-full bg-nav-active px-2 text-xs leading-none font-semibold text-nav-active-foreground">{{ identity === 'front_desk' ? '櫃台' : '醫師' }}</span>
  </nav>
</template>
