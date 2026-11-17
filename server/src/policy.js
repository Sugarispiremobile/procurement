/** Разбирает список доменов из переменной окружения: "a.com, B.org" → ['a.com', 'b.org']. */
export const parseDomains = (s) =>
  String(s ?? '').split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);

/** Пустой список — ограничений нет. */
export function isEmailAllowed(email, domains) {
  if (!domains.length) return true;
  const domain = String(email).toLowerCase().split('@').pop();
  return domains.includes(domain);
}

/** TRUST_PROXY: пусто/0/false → не доверять; число → число прокси; иначе — значение Express (loopback, ...). */
export function parseTrustProxy(v) {
  const s = String(v ?? '').trim();
  if (!s || s === '0' || s.toLowerCase() === 'false') return false;
  if (s.toLowerCase() === 'true') return 1;
  return /^\d+$/.test(s) ? Number(s) : s;
}
