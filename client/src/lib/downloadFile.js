export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// axios 用 responseType: 'blob' 時，錯誤回應的 JSON 也會被包成 Blob，要解出來才拿得到後端的 message
export async function extractErrorMessage(err, fallback) {
  const data = err.response?.data;
  if (data instanceof Blob) {
    try {
      return JSON.parse(await data.text()).message ?? fallback;
    } catch {
      return fallback;
    }
  }
  return data?.message ?? fallback;
}
