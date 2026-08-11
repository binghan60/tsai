<script setup>
import { ref, onMounted, watch } from 'vue';
import { http } from '../api/http';

const owners = ref([]);
const query = ref('');
const loading = ref(false);
const error = ref('');

const newOwner = ref({ name: '', phone: '', email: '' });
const creating = ref(false);

async function fetchOwners() {
  loading.value = true;
  error.value = '';
  try {
    const { data } = await http.get('/owners', { params: query.value ? { q: query.value } : {} });
    owners.value = data;
  } catch (err) {
    error.value = '飼主列表載入失敗，請確認後端與資料庫是否已啟動';
  } finally {
    loading.value = false;
  }
}

async function createOwner() {
  if (!newOwner.value.name || !newOwner.value.phone) return;
  creating.value = true;
  try {
    await http.post('/owners', newOwner.value);
    newOwner.value = { name: '', phone: '', email: '' };
    await fetchOwners();
  } catch (err) {
    error.value = '新增飼主失敗';
  } finally {
    creating.value = false;
  }
}

let debounceTimer;
watch(query, () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fetchOwners, 300);
});

onMounted(fetchOwners);
</script>

<template>
  <section>
    <h1>飼主列表</h1>

    <input v-model="query" type="text" placeholder="搜尋姓名或電話" />

    <form @submit.prevent="createOwner" class="new-owner-form">
      <input v-model="newOwner.name" type="text" placeholder="姓名" required />
      <input v-model="newOwner.phone" type="text" placeholder="電話" required />
      <input v-model="newOwner.email" type="email" placeholder="Email（選填）" />
      <button type="submit" :disabled="creating">新增飼主</button>
    </form>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading">載入中…</p>

    <table v-else>
      <thead>
        <tr>
          <th>姓名</th>
          <th>電話</th>
          <th>Email</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="owner in owners" :key="owner._id">
          <td><router-link :to="`/owners/${owner._id}`">{{ owner.name }}</router-link></td>
          <td>{{ owner.phone }}</td>
          <td>{{ owner.email }}</td>
        </tr>
        <tr v-if="owners.length === 0">
          <td colspan="3">目前沒有飼主資料</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.new-owner-form {
  display: flex;
  gap: 0.5rem;
  margin: 1rem 0;
}
.error {
  color: #c0392b;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th, td {
  text-align: left;
  padding: 0.5rem;
  border-bottom: 1px solid #ddd;
}
</style>
