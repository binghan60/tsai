<script setup>
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { Button } from '../components/ui/button';
import Input from '../components/ui/input/Input.vue';
import Label from '../components/ui/label/Label.vue';

const route = useRoute();
const router = useRouter();
const username = ref('');
const password = ref('');
const error = ref('');
const submitting = ref(false);
const auth = useAuthStore();
const redirectTo = computed(() => {
  const value = String(route.query.redirect ?? '');
  return value.startsWith('/') && !value.startsWith('/login') ? value : '/';
});

async function login() {
  error.value = '';
  submitting.value = true;
  try {
    await auth.login({ username: username.value, password: password.value });
    await router.replace(redirectTo.value);
  } catch (err) {
    error.value = err.response?.data?.message ?? '登入失敗，請稍後再試。';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="grid min-h-screen place-items-center bg-muted/30 px-4 py-8">
    <form class="w-full max-w-sm space-y-5 rounded-xl border bg-card p-6 shadow-sm" @submit.prevent="login">
      <div class="space-y-1">
        <h1 class="text-xl font-semibold">診所系統登入</h1>
        <p class="text-sm text-muted-foreground">請使用診所共用帳號登入。</p>
      </div>

      <p v-if="error" class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{{ error }}</p>

      <div class="space-y-2">
        <Label for="username">帳號</Label>
        <Input id="username" v-model="username" autocomplete="username" required />
      </div>
      <div class="space-y-2">
        <Label for="password">密碼</Label>
        <Input id="password" v-model="password" type="password" autocomplete="current-password" required />
      </div>

      <Button type="submit" class="w-full" :disabled="submitting">
        {{ submitting ? '登入中…' : '登入' }}
      </Button>
    </form>
  </main>
</template>
