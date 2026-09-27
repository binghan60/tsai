<script setup>
import { ref } from 'vue';
import { Bell, LogOut, Moon, Settings, Stethoscope, Sun, UserRound } from '@lucide/vue';
import { useTheme } from '../composables/useTheme';
import { useStaffIdentity } from '../composables/useStaffIdentity';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
import NotificationSettingsDialog from './NotificationSettingsDialog.vue';

// 設定集中在一處：這台裝置的身分（醫師／櫃台）、明暗主題、自動通知、登出。
// rail：左側導覽欄底部的版本（圖示＋「設定」二字，選單往右彈）；
// 預設：手機頁首的圖示鈕（選單往下彈）。
defineProps({ rail: Boolean });
const emit = defineEmits(['logout']);
const { isDark, toggleTheme } = useTheme();
const { identity, setIdentity } = useStaffIdentity();
const notificationsOpen = ref(false);
</script>

<template>
  <DropdownMenu :modal="false">
    <DropdownMenuTrigger as-child>
      <button
        v-if="rail"
        type="button"
        class="flex h-13 w-15 flex-col items-center justify-center gap-1 rounded-[10px] text-nav-foreground transition-colors hover:bg-hover aria-expanded:bg-hover"
        aria-label="設定：身分、主題、通知、登出"
      >
        <Settings class="size-5" stroke-width="1.75" />
        <span class="text-2xs leading-none font-medium">設定</span>
      </button>
      <button v-else type="button" class="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-hover" aria-label="開啟設定選單">
        <Settings class="size-5" stroke-width="1.75" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent :side="rail ? 'right' : 'bottom'" :align="rail ? 'end' : 'end'" class="w-64">
      <DropdownMenuLabel>這台裝置的身分</DropdownMenuLabel>
      <DropdownMenuItem @select="setIdentity('vet')">
        <Stethoscope stroke-width="1.75" /><span class="flex-1">醫師</span><span v-if="identity === 'vet'" class="text-sm font-semibold text-primary">目前</span>
      </DropdownMenuItem>
      <DropdownMenuItem @select="setIdentity('front_desk')">
        <UserRound stroke-width="1.75" /><span class="flex-1">櫃台</span><span v-if="identity === 'front_desk'" class="text-sm font-semibold text-primary">目前</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem @select="toggleTheme">
        <component :is="isDark ? Sun : Moon" stroke-width="1.75" />{{ isDark ? '切換成淺色' : '切換成深色' }}
      </DropdownMenuItem>
      <DropdownMenuItem @select="notificationsOpen = true">
        <Bell stroke-width="1.75" />自動通知設定
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" @select="emit('logout')">
        <LogOut stroke-width="1.75" />登出
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
  <NotificationSettingsDialog v-model:open="notificationsOpen" />
</template>
