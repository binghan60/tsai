<script setup>
import { ref } from 'vue';
import { LogOut, Moon, Settings, Sun, UserRound } from '@lucide/vue';
import { useTheme } from '../composables/useTheme';
import { useStaffIdentity } from '../composables/useStaffIdentity';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Button } from './ui/button';

defineProps({ iconOnly: Boolean });
const emit = defineEmits(['logout']);
const { isDark, toggleTheme } = useTheme();
const { identity, setIdentity } = useStaffIdentity();
const open = ref(false);
function changeIdentity() { setIdentity(identity.value === 'vet' ? 'front_desk' : 'vet'); }
function logout() { open.value = false; emit('logout'); }
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button v-if="iconOnly" variant="outline" size="icon" aria-label="開啟設定選單"><Settings class="h-4 w-4" /></Button>
      <button v-else type="button" class="flex min-h-11 w-full items-center gap-3 rounded-lg border border-sidebar-border/80 bg-sidebar-accent/45 px-2.5 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" aria-label="開啟設定選單"><Settings class="h-4 w-4" />設定</button>
    </PopoverTrigger>
    <PopoverContent :side="iconOnly ? 'bottom' : 'top'" :align="iconOnly ? 'end' : 'start'" class="w-64 p-2">
      <p class="px-3 py-2 text-sm font-semibold">設定</p>
      <button type="button" class="settings-item" @click="changeIdentity"><UserRound class="h-4 w-4" /><span>{{ identity === 'vet' ? '切換為櫃台' : '切換為醫師' }}</span></button>
      <button type="button" class="settings-item mt-1" @click="toggleTheme"><Sun v-if="isDark" class="h-4 w-4" /><Moon v-else class="h-4 w-4" />{{ isDark ? '淺色模式' : '深色模式' }}</button>
      <div class="my-2 border-t border-border"></div>
      <button type="button" class="settings-item text-destructive" @click="logout"><LogOut class="h-4 w-4" />登出</button>
    </PopoverContent>
  </Popover>
</template>

<style scoped>
.settings-item { display: flex; align-items: center; gap: .75rem; width: 100%; min-height: 2.75rem; padding: .5rem .75rem; border-radius: .5rem; background: var(--field); font-size: var(--text-sm); text-align: left; }
.settings-item:hover { background: var(--muted); }
.settings-item:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
</style>
