<script setup>
import { useRoute, useRouter } from 'vue-router';
import LoginForm from '../components/LoginForm.vue';
import { Card, CardContent } from '../components/ui/card';
import { safeRedirectPath } from '../lib/authRedirect';

const route = useRoute();
const router = useRouter();

// 回到被守衛攔下來之前要去的那一頁；沒有就進工作台。
function enter() {
  router.replace(safeRedirectPath(route.query.redirect));
}
</script>

<template>
  <div class="belle-light-shell flex min-h-screen items-center justify-center px-4 py-10 text-foreground">
    <Card class="w-full max-w-sm py-8 shadow-sm">
      <CardContent class="px-6 sm:px-8">
        <div class="mb-6 flex flex-col items-center text-center">
          <img src="/chien-hua-logo-mark-v2.png" alt="" aria-hidden="true" class="h-16 w-16 object-contain" />
          <h1 class="mt-3 text-xl font-semibold text-foreground">謙華動物醫院</h1>
          <p class="mt-1 text-xs text-muted-foreground">健檢與報告</p>
        </div>
        <LoginForm @success="enter" />
      </CardContent>
    </Card>
  </div>
</template>
