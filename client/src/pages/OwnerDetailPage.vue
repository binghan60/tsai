<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { http } from '../api/http';

const route = useRoute();
const owner = ref(null);
const error = ref('');
const newPetName = ref('');
const creating = ref(false);

async function fetchOwner() {
  error.value = '';
  try {
    const { data } = await http.get(`/owners/${route.params.id}`);
    owner.value = data;
  } catch (err) {
    error.value = '飼主資料載入失敗';
  }
}

async function createPet() {
  if (!newPetName.value) return;
  creating.value = true;
  try {
    await http.post(`/owners/${route.params.id}/pets`, { name: newPetName.value });
    newPetName.value = '';
    await fetchOwner();
  } catch (err) {
    error.value = '新增貓咪失敗';
  } finally {
    creating.value = false;
  }
}

onMounted(fetchOwner);
</script>

<template>
  <section v-if="owner">
    <router-link to="/owners">← 回飼主列表</router-link>
    <h1>{{ owner.name }}</h1>
    <p>電話：{{ owner.phone }}</p>
    <p v-if="owner.email">Email：{{ owner.email }}</p>

    <h2>貓咪</h2>
    <form @submit.prevent="createPet" class="new-pet-form">
      <input v-model="newPetName" type="text" placeholder="貓咪名字" required />
      <button type="submit" :disabled="creating">新增貓咪</button>
    </form>

    <ul>
      <li v-for="pet in owner.pets" :key="pet._id">
        <router-link :to="`/pets/${pet._id}`">{{ pet.name }}</router-link>
      </li>
      <li v-if="owner.pets.length === 0">尚無貓咪資料</li>
    </ul>
  </section>
  <p v-else-if="error" class="error">{{ error }}</p>
  <p v-else>載入中…</p>
</template>

<style scoped>
.new-pet-form {
  display: flex;
  gap: 0.5rem;
  margin: 1rem 0;
}
.error {
  color: #c0392b;
}
</style>
