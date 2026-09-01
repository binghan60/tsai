<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ImagePlus, LoaderCircle, Trash2 } from '@lucide/vue';
import { http } from '../../api/http';
import FieldShell from './FieldShell.vue';
import { Button } from '../ui/button';
import { useRecordForm } from './context';

const props = defineProps({ item: { type: Object, required: true }, modelValue: { type: Array, default: () => [] } });
const emit = defineEmits(['update:modelValue']);
const { preview, registerImageUploader } = useRecordForm();
const input = ref(null);
const uploading = ref(false);
const error = ref('');
const uploadSpan = ref(12);
const IMAGE_SIZE_OPTIONS = [
  { span: 4, label: '小圖', hint: '每列 3 張' },
  { span: 6, label: '中圖', hint: '每列 2 張' },
  { span: 12, label: '大圖', hint: '滿寬顯示' },
];
const inputId = computed(() => `record-${props.item.key}`);
const images = computed(() => (Array.isArray(props.modelValue) ? props.modelValue.filter((image) => image?.url) : []));
const spanClass = (image) => ({ 4: 'col-span-4', 6: 'col-span-6', 12: 'col-span-12' }[Number(image?.span)] ?? 'col-span-12');

async function compressImage(file) {
  // GIF 保留動畫；SVG 可能含有可執行內容，不接受上傳。
  if (file.type === 'image/gif') return file;
  const source = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = source;
    });
    const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = Math.min(1, 2048 / longestEdge);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
    if (!blob) throw new Error('圖片壓縮失敗');
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'image'}.webp`, { type: 'image/webp' });
  } finally {
    URL.revokeObjectURL(source);
  }
}

function remove(index) {
  const image = images.value[index];
  if (image?.pendingFile && image.url?.startsWith('blob:')) URL.revokeObjectURL(image.url);
  emit('update:modelValue', images.value.filter((_, imageIndex) => imageIndex !== index));
}
function stage(event) {
  const files = [...(event.target.files ?? [])];
  event.target.value = '';
  if (!files.length) return;
  const invalid = files.find((file) => !['image/webp', 'image/png', 'image/jpeg', 'image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024);
  if (invalid) { error.value = '請選擇 10 MB 以下的圖片檔案'; return; }
  if (images.value.length + files.length > 12) { error.value = '每個圖片欄位最多可上傳 12 張'; return; }

  error.value = '';
  emit('update:modelValue', [...images.value, ...files.map((file) => ({ url: URL.createObjectURL(file), pendingFile: file, span: uploadSpan.value }))]);
}
async function uploadPending() {
  const pending = images.value.filter((image) => image?.pendingFile instanceof File);
  if (!pending.length) return;
  uploading.value = true;
  error.value = '';
  try {
    const compressedFiles = await Promise.all(pending.map((image) => compressImage(image.pendingFile)));
    for (const [index, file] of compressedFiles.entries()) {
      const { data: signature } = await http.get('/uploads/image-signature');
      const form = new FormData();
      form.append('file', file);
      form.append('api_key', signature.apiKey);
      form.append('timestamp', String(signature.timestamp));
      form.append('folder', signature.folder);
      form.append('public_id', signature.public_id);
      form.append('overwrite', String(signature.overwrite));
      form.append('allowed_formats', signature.allowed_formats);
      form.append('max_file_size', String(signature.max_file_size));
      form.append('upload_preset', signature.upload_preset);
      form.append('signature', signature.signature);
      const response = await fetch(`https://api.cloudinary.com/v1_1/${signature.cloudName}/image/upload`, { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? '圖片上傳失敗');
      const uploadedImage = { url: data.secure_url, publicId: data.public_id, width: data.width, height: data.height, format: data.format, span: pending[index].span ?? 12 };
      const pendingImage = pending[index];
      if (pendingImage.url?.startsWith('blob:')) URL.revokeObjectURL(pendingImage.url);
      emit('update:modelValue', images.value.map((image) => image === pendingImage ? uploadedImage : image));
    }
  } catch (err) {
    error.value = err.response?.data?.message ?? err.message ?? '圖片上傳失敗';
    throw err;
  } finally {
    uploading.value = false;
  }
}
let unregister = null;
onMounted(() => { unregister = registerImageUploader?.(uploadPending) ?? null; });
onBeforeUnmount(() => unregister?.());
</script>

<template>
  <FieldShell :item="item" :input-id="inputId">
    <div class="space-y-3">
      <div v-if="images.length" class="grid grid-cols-12 gap-4">
        <div v-for="(image, index) in images" :key="image.publicId || image.url" class="group relative overflow-hidden rounded-xl border border-border bg-muted" :class="spanClass(image)">
          <img :src="image.url" :alt="`${item.label}圖片 ${index + 1}`" class="block h-auto w-full" />
          <Button v-if="!preview" type="button" variant="secondary" size="icon" class="absolute right-2 top-2 shadow-sm" :aria-label="`刪除圖片 ${index + 1}`" @click="remove(index)"><Trash2 class="h-4 w-4" /></Button>
        </div>
      </div>
      <div v-if="!preview" class="flex flex-wrap items-center gap-3">
        <div class="flex items-center gap-1 rounded-lg border border-border bg-field p-1" aria-label="新增圖片大小">
          <span class="pl-2 text-xs text-muted-foreground">圖片大小</span>
          <button v-for="option in IMAGE_SIZE_OPTIONS" :key="option.span" type="button" class="min-h-8 rounded-md px-2 text-xs font-medium transition-colors" :class="uploadSpan === option.span ? 'bg-accent text-accent-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'" :title="option.hint" @click="uploadSpan = option.span">{{ option.label }}</button>
        </div>
        <input :id="inputId" ref="input" type="file" class="sr-only" accept="image/webp,image/png,image/jpeg,image/gif" multiple :disabled="uploading" @change="stage" />
        <Button type="button" variant="outline" :disabled="uploading" @click="input?.click()"><LoaderCircle v-if="uploading" class="h-4 w-4 animate-spin" /><ImagePlus v-else class="h-4 w-4" />{{ uploading ? '上傳中…' : '新增圖片' }}</Button>
        <span class="text-xs text-muted-foreground">選取後會先暫存，確認儲存時才上傳。每張最多 10 MB，最多 12 張</span>
      </div>
      <p v-if="error" class="text-sm text-danger">{{ error }}</p>
      <p v-else-if="!images.length && preview" class="text-sm text-muted-foreground">尚未上傳圖片。</p>
    </div>
  </FieldShell>
</template>
