import { ref } from 'vue';
import { http } from '../api/http';

// 一份範本 = 一種健檢類型。範本很少變動，依 id 快取在模組層級，換頁不用重抓。
const template = ref(null);
const cache = new Map();
const inflight = new Map();

export function useFormTemplate() {
  // 載入指定健檢類型的表單結構。沒有「預設類型」，一律要明確指定 id。
  async function loadTemplate(templateId, { force = false } = {}) {
    if (!templateId) throw new Error('必須指定健檢類型');
    const cacheKey = templateId;
    if (!force && cache.has(cacheKey)) {
      template.value = cache.get(cacheKey);
      return template.value;
    }
    if (!inflight.has(cacheKey)) {
      const request = http.get(`/settings/form-templates/${templateId}`)
        .then(({ data }) => {
          cache.set(cacheKey, data);
          cache.set(data._id, data);
          template.value = data;
          return data;
        })
        .finally(() => inflight.delete(cacheKey));
      inflight.set(cacheKey, request);
    }
    return inflight.get(cacheKey);
  }

  // 帶 species 時只拿到適用於該物種的表單（含不限物種的）。
  async function listTemplates({ species } = {}) {
    const { data } = await http.get('/settings/form-templates', {
      params: species ? { species } : {},
    });
    return data;
  }

  function clearTemplateCache() {
    cache.clear();
  }

  return { template, loadTemplate, listTemplates, clearTemplateCache };
}
