<script setup>
import { useRoute } from 'vue-router';

const route = useRoute();
</script>

<template>
  <div v-if="route.meta.bare">
    <router-view />
  </div>
  <div v-else class="app-shell">
    <nav>
      <router-link to="/">儀錶板</router-link>
      <router-link to="/owners">飼主</router-link>
    </nav>
    <main>
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.app-shell nav {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  border-bottom: 1px solid #ddd;
}
.app-shell main {
  padding: 1rem;
}
</style>
