const TOKEN_KEY = 'procurement-token';

export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
export const setToken = (t) => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
};

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
  /** Сообщение + список ошибок по полям одной строкой. */
  get full() {
    if (!this.details?.length) return this.message;
    return `${this.message}: ${this.details.map((d) => d.message).join('; ')}`;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function raw(method, url, body) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`/api${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Нет связи с сервером');
  }
  if (res.status === 401 && token && !url.startsWith('/auth/login')) onUnauthorized();
  return res;
}

async function request(method, url, body) {
  const res = await raw(method, url, body);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'Ошибка запроса', data?.details);
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b ?? {}),
  put: (u, b) => request('PUT', u, b),
  patch: (u, b) => request('PATCH', u, b),
  del: async (u) => {
    const res = await raw('DELETE', u);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new ApiError(res.status, data?.error ?? 'Ошибка запроса', data?.details);
    }
  },
};

/** Загрузка файла «сырым» телом; имя передаётся в заголовке. */
export async function upload(url, file) {
  const headers = { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`/api${url}`, { method: 'POST', headers, body: file });
  } catch {
    throw new ApiError(0, 'Нет связи с сервером');
  }
  if (res.status === 401 && token) onUnauthorized();
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'Не удалось загрузить файл', data?.details);
  return data;
}

/** Скачивание файла (CSV, вложение) с авторизацией. */
export async function download(url, filename) {
  const res = await raw('GET', url);
  if (!res.ok) throw new ApiError(res.status, 'Не удалось выгрузить файл');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
