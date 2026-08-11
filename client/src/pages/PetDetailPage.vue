<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { http } from '../api/http';

const route = useRoute();
const pet = ref(null);
const error = ref('');

async function fetchPet() {
  try {
    const { data } = await http.get(`/pets/${route.params.id}`);
    pet.value = data;
  } catch (err) {
    error.value = '貓咪資料載入失敗';
  }
}

onMounted(fetchPet);
</script>

<template>
  <section v-if="pet">
    <router-link :to="`/owners/${pet.ownerId}`">← 回飼主詳情</router-link>
    <h1>{{ pet.name }}</h1>

    <h2>歷次報告</h2>
    <!-- TODO: 報告填寫表單完成後補上「新增報告」與各報告的編輯／下載 PDF／寄送操作 -->
    <ul>
      <li v-for="record in pet.medicalRecords" :key="record._id">
        {{ new Date(record.visitDate).toLocaleDateString() }} — {{ record.status }}
      </li>
      <li v-if="pet.medicalRecords.length === 0">尚無報告紀錄</li>
    </ul>
  </section>
  <p v-else-if="error" class="error">{{ error }}</p>
  <p v-else>載入中…</p>
</template>

<style scoped>
.error {
  color: #c0392b;
}
</style>
