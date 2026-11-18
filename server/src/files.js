// Вложения: допустимые типы, проверка по сигнатуре (а не только по расширению), безопасное имя.
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 5;

export const MIME = {
  pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const starts = (buf, bytes, at = 0) => bytes.every((b, i) => buf[at + i] === b);

/** Тип по содержимому: 'pdf' | 'jpg' | 'png' | 'webp' | 'xlsx' | 'docx' | null. */
export function detectType(buf) {
  if (!buf || buf.length < 12) return null;
  if (starts(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';
  if (starts(buf, [0xff, 0xd8, 0xff])) return 'jpg';
  if (starts(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (starts(buf, [0x52, 0x49, 0x46, 0x46]) && starts(buf, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  if (starts(buf, [0x50, 0x4b, 0x03, 0x04])) {
    if (!buf.includes('[Content_Types].xml')) return null;
    if (buf.includes('word/')) return 'docx';
    if (buf.includes('xl/')) return 'xlsx';
  }
  return null;
}

export const extOf = (name) => {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name ?? '');
  const e = m ? m[1].toLowerCase() : '';
  return e === 'jpeg' ? 'jpg' : e;
};
export const extensionMatches = (name, type) => extOf(name) === type;

export function cleanFileName(name) {
  const base = String(name ?? '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"<>:*?|]/g, '').trim();
  return (base || 'file').slice(-120);
}

/** Content-Disposition: attachment с корректным именем (RFC 5987). */
export const contentDisposition = (name) => {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()]/g, escape)}`;
};
