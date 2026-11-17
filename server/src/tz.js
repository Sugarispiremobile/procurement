// Часовой пояс приложения. «Сегодня» считается в нём, а не в поясе сервера или PostgreSQL.
const FALLBACK = 'Asia/Almaty';

const isValidTz = (z) => {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: z });
    return true;
  } catch {
    return false;
  }
};

const fromEnv = process.env.APP_TIMEZONE?.trim();
if (fromEnv && !isValidTz(fromEnv)) {
  console.warn(`APP_TIMEZONE="${fromEnv}" не распознан, используется ${FALLBACK}`);
}
export const APP_TIMEZONE = fromEnv && isValidTz(fromEnv) ? fromEnv : FALLBACK;

/** Дата YYYY-MM-DD в часовом поясе приложения. */
export function todayStr(d = new Date(), timeZone = APP_TIMEZONE) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}
