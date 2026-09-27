import { http } from '../api/http';

// 同一份健檢表單常常被好幾個工作區同時用到（今天的掛號大多選同一份），
// 完整結構只抓一次、存在模組層級；表單設計頁改過之後，重新整理頁面就會重抓。
const cache = new Map();

export function loadFormTemplate(id) {
  if (!id) return Promise.resolve(null);
  const key = String(id);
  if (!cache.has(key)) {
    const request = http.get(`/settings/form-templates/${key}`).then(({ data }) => data).catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, request);
  }
  return cache.get(key);
}
