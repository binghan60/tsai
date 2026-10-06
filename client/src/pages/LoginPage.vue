<script setup>
import { apiErrorMessage } from '../lib/apiError';
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
    error.value = apiErrorMessage(err, '登入失敗，請稍後再試。');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="grid min-h-screen place-items-center bg-background px-4 py-8">
    <form class="w-full max-w-md space-y-6 rounded-2xl border border-border bg-card p-8 shadow-card" @submit.prevent="login">
      <div class="flex items-center gap-3">
        <img src="/chien-hua-logo-mark-v2.png" alt="" aria-hidden="true" class="h-12 w-15 object-contain" />
        <div>
          <h1 class="text-xl leading-tight font-semibold">謙華動物醫院</h1>
        </div>
      </div>

      <p v-if="error" class="rounded-lg bg-destructive-surface px-4 py-3 text-destructive" role="alert">{{ error }}</p>

      <div class="space-y-1.5">
        <Label for="username">帳號</Label>
        <Input id="username" v-model="username" autocomplete="username" required />
      </div>
      <div class="space-y-1.5">
        <Label for="password">密碼</Label>
        <Input id="password" v-model="password" type="password" autocomplete="current-password" required />
      </div>

      <Button type="submit" size="lg" class="w-full" :disabled="submitting">
        {{ submitting ? '登入中…' : '登入' }}
      </Button>
    </form>
  </main>
</template>
