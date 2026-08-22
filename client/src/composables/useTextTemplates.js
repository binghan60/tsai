import { ref } from 'vue';
import { http } from '../api/http';

const templates = ref([]);
const loaded = ref(false);
const includesDisabled = ref(false);
const picker = ref(null);
let inflight = null;

function compare(a, b) {
  if ((a.usageCount ?? 0) !== (b.usageCount ?? 0)) return (b.usageCount ?? 0) - (a.usageCount ?? 0);
  return String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''));
}

export function useTextTemplates() {
  async function loadTemplates({ force = false, includeDisabled = false } = {}) {
    if (loaded.value && !force && (!includeDisabled || includesDisabled.value)) return templates.value;
    if (!inflight) {
      inflight = http.get('/text-templates', { params: includeDisabled ? { includeDisabled: 1 } : {} })
        .then(({ data }) => {
          templates.value = Array.isArray(data) ? data : [];
          loaded.value = true;
          includesDisabled.value = includeDisabled;
          return templates.value;
        })
        .catch((error) => {
          if (!loaded.value) templates.value = [];
          throw error;
        })
        .finally(() => { inflight = null; });
    }
    return inflight;
  }

  function templatesFor(itemKey, { all = false } = {}) {
    return templates.value
      .filter((template) => template.enabled !== false)
      .filter((template) => all || template.availableForAllFields || template.applicableItemKeys?.includes(itemKey))
      .sort(compare);
  }

  function openPicker(context) {
    picker.value = context;
  }

  function closePicker() {
    picker.value = null;
  }

  function markUsed(template) {
    if (!template?._id) return;
    http.post(`/text-templates/${template._id}/use`).catch(() => {});
  }

  async function createTemplate(payload) {
    const { data } = await http.post('/text-templates', payload);
    templates.value.push(data);
    return data;
  }

  async function updateTemplate(id, payload) {
    const { data } = await http.put(`/text-templates/${id}`, payload);
    const index = templates.value.findIndex((entry) => entry._id === id);
    if (index >= 0) templates.value.splice(index, 1, data);
    else templates.value.push(data);
    return data;
  }

  async function deleteTemplate(id) {
    await http.delete(`/text-templates/${id}`);
    templates.value = templates.value.filter((entry) => entry._id !== id);
  }

  return {
    templates,
    picker,
    loadTemplates,
    templatesFor,
    openPicker,
    closePicker,
    markUsed,
    createTemplate,
    updateTemplate,
    deleteTemplate,
  };
}
