<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ImagePlus, LoaderCircle, Trash2 } from '@lucide/vue';
import { http } from '../../api/http';
import FieldShell from './FieldShell.vue';
import { Button } from '../ui/button';
import { useRecordForm } from './context';

let mountedImageUploaderCount = 0;
let activeImageUploaderId = '';

const props = defineProps({ item: { type: Object, required: true }, modelValue: { type: Array, default: () => [] } });
const emit = defineEmits(['update:modelValue']);
const { preview, registerImageUploader } = useRecordForm();
const input = ref(null);
const uploading = ref(false);
const dragging = ref(false);
const error = ref('');
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
function updateSpan(index, span) {
  emit('update:modelValue', images.value.map((image, imageIndex) => (
    imageIndex === index ? { ...image, span } : image
  )));
}
function updateCaption(index, caption) {
  emit('update:modelValue', images.value.map((image, imageIndex) => (
    imageIndex === index ? { ...image, caption } : image
  )));
}
function stageFiles(files) {
  if (!files.length) return;
  const invalid = files.find((file) => !['image/webp', 'image/png', 'image/jpeg', 'image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024);
  if (invalid) { error.value = '請選擇 10 MB 以下的圖片檔案'; return; }
  if (images.value.length + files.length > 12) { error.value = '每個圖片欄位最多可上傳 12 張'; return; }

  error.value = '';
  emit('update:modelValue', [...images.value, ...files.map((file) => ({ url: URL.createObjectURL(file), pendingFile: file, span: 12 }))]);
}
function stage(event) {
  stageFiles([... (event.target.files ?? [])]);
  event.target.value = '';
}
function drop(event) {
  dragging.value = false;
  stageFiles([...(event.dataTransfer?.files ?? [])]);
}
function paste(event) {
  const files = [...(event.clipboardData?.items ?? [])]
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (!files.length) return;
  event.preventDefault();
  stageFiles(files);
}
function pasteFromWindow(event) {
  // 正在編輯文字時，讓原生貼上維持原本行為；其餘情況可直接貼上圖片，
  // 不必先點上傳區（點擊會開啟檔案選擇器）。
  if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  if (mountedImageUploaderCount > 1 && activeImageUploaderId !== inputId.value) return;
  paste(event);
}
function activatePasteTarget() {
  activeImageUploaderId = inputId.value;
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
      const uploadedImage = { url: data.secure_url, publicId: data.public_id, width: data.width, height: data.height, format: data.format, span: pending[index].span ?? 12, caption: pending[index].caption ?? '' };
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
onMounted(() => {
  mountedImageUploaderCount += 1;
  unregister = registerImageUploader?.(uploadPending) ?? null;
  window.addEventListener('paste', pasteFromWindow);
});
onBeforeUnmount(() => {
  mountedImageUploaderCount -= 1;
  if (activeImageUploaderId === inputId.value) activeImageUploaderId = '';
  unregister?.();
  window.removeEventListener('paste', pasteFromWindow);
});
</script>

<template>
  <FieldShell :item="item" :input-id="inputId">
    <div class="space-y-3">
      <div v-if="images.length" class="grid grid-cols-12 gap-4">
        <div v-for="(image, index) in images" :key="image.publicId || image.url" class="group relative overflow-hidden rounded-xl border border-border bg-muted" :class="spanClass(image)">
          <img :src="image.url" :alt="`${item.label}圖片 ${index + 1}`" class="block h-auto w-full" />
          <template v-if="!preview">
            <Button type="button" variant="secondary" size="icon" class="absolute right-2 top-2 shadow-sm" :aria-label="`刪除圖片 ${index + 1}`" @click="remove(index)"><Trash2 class="h-4 w-4" /></Button>
            <div class="absolute left-2 top-2 flex items-center gap-1 rounded-lg border border-border bg-background/95 p-1 shadow-sm backdrop-blur" :aria-label="`調整圖片 ${index + 1} 的版型`">
              <button v-for="option in IMAGE_SIZE_OPTIONS" :key="option.span" type="button" class="min-h-8 rounded-md px-2 text-xs font-medium transition-colors" :class="Number(image.span) === option.span ? 'bg-accent text-accent-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'" :title="option.hint" @click="updateSpan(index, option.span)">{{ option.label }}</button>
            </div>
            <div class="border-t border-border bg-background p-3">
              <label :for="`${inputId}-caption-${index}`" class="mb-1 block text-xs font-medium text-muted-foreground">圖片說明</label>
              <textarea :id="`${inputId}-caption-${index}`" :value="image.caption ?? ''" rows="2" maxlength="500" class="flex min-h-16 w-full rounded-lg border border-input bg-field px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30" placeholder="輸入圖片說明…" @input="updateCaption(index, $event.target.value)" />
            </div>
          </template>
        </div>
      </div>
      <div v-if="!preview" class="space-y-2">
        <input :id="inputId" ref="input" type="file" class="sr-only" accept="image/webp,image/png,image/jpeg,image/gif" multiple :disabled="uploading" @change="stage" />
        <div
          role="button"
          tabindex="0"
          class="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-5 text-center transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          :class="[images.length ? 'min-h-24 border-border bg-muted/30 hover:border-primary/60 hover:bg-muted/50' : 'min-h-48 border-primary/30 bg-primary/5 hover:border-primary/60 hover:bg-primary/10', dragging ? 'border-primary bg-primary/10' : '', uploading ? 'cursor-wait opacity-60' : '']"
          :aria-label="images.length ? '拖放、貼上或選取更多圖片' : '拖放、貼上或選取圖片'"
          @click="activatePasteTarget(); !uploading && input?.click()"
          @mouseenter="activatePasteTarget"
          @focus="activatePasteTarget"
          @keydown.enter.prevent="activatePasteTarget(); !uploading && input?.click()"
          @keydown.space.prevent="activatePasteTarget(); !uploading && input?.click()"
          @dragenter.prevent="dragging = true"
          @dragover.prevent="dragging = true"
          @dragleave.prevent="dragging = false"
          @drop.prevent="drop"
        >
          <LoaderCircle v-if="uploading" class="mb-2 h-6 w-6 animate-spin text-primary" />
          <ImagePlus v-else class="mb-2 h-7 w-7 text-primary" />
          <p class="text-sm font-medium text-foreground">{{ uploading ? '圖片上傳中…' : images.length ? '拖放、貼上或點擊加入更多圖片' : '將圖片拖到這裡' }}</p>
          <p class="mt-1 text-xs text-muted-foreground">{{ images.length ? '也可以直接按 Ctrl／⌘ + V 貼上圖片' : '也可以直接按 Ctrl／⌘ + V 貼上圖片，或點擊手動選取檔案' }}</p>
          <p class="mt-2 text-xs text-muted-foreground">選取後會先暫存，確認儲存時才上傳。每張最多 10 MB，最多 12 張</p>
        </div>
      </div>
      <p v-if="error" class="text-sm text-danger">{{ error }}</p>
      <p v-else-if="!images.length && preview" class="text-sm text-muted-foreground">尚未上傳圖片。</p>
    </div>
  </FieldShell>
</template>
