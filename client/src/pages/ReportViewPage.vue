<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { http } from '../api/http';

const route = useRoute();
const record = ref(null);
const error = ref('');

async function fetchReport() {
  try {
    const { data } = await http.get(`/public/reports/${route.params.token}`);
    record.value = data;
  } catch (err) {
    error.value = '找不到這份報告，連結可能已失效';
  }
}

onMounted(fetchReport);
</script>

<template>
  <!-- 公開頁面：無導覽列、無登入，同時作為 Puppeteer PDF 截圖來源 -->
  <section v-if="record">
    <p>TODO：報告版型（診斷、治療計畫等），並補上 @media print 樣式隱藏非報告內容。</p>
  </section>
  <p v-else-if="error">{{ error }}</p>
  <p v-else>載入中…</p>
</template>
