import { config } from './config.js';

/** «Сегодня» (ГГГГ-ММ-ДД) в часовом поясе приложения APP_TZ (F5). */
export const todayStr = (now = new Date(), timeZone = config.timeZone) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
