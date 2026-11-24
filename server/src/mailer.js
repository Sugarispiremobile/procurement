// E-mail (nodemailer), асинхронно: ошибка почты не ломает основной запрос. Без SMTP_HOST письма пишутся в лог и в outbox.
import nodemailer from 'nodemailer';
import { config } from './config.js';
import { query } from './db.js';

export const outbox = [];

let transport;
const getTransport = () => {
  if (!config.smtp.host) return null;
  transport ??= nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transport;
};

async function deliver({ to, subject, text }) {
  const t = getTransport();
  if (!t) {
    outbox.push({ to, subject, text, at: new Date() });
    if (outbox.length > 200) outbox.shift();
    if (config.logLevel !== 'silent') {
      // в production тело письма (ссылки-приглашения/сброса) в лог не пишем
      console.log(config.isProd ? `[mail] → ${to} | ${subject} (SMTP не настроен, текст не логируется)` : `[mail] → ${to} | ${subject}\n${text}`);
    }
    return;
  }
  await t.sendMail({ from: config.smtp.from, to, subject, text });
}

export function sendMail(msg) {
  deliver(msg).catch((e) => console.error('[mail] ошибка отправки:', e.message));
}

/** Уведомление по id; уважает «Получать уведомления по email» и блокировку. */
export function notifyUsers(userIds, subject, text) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  query('SELECT email FROM users WHERE id = ANY($1) AND is_active AND notify_email', [ids])
    .then(({ rows }) => rows.forEach((r) => sendMail({ to: r.email, subject, text })))
    .catch((e) => console.error('[mail] ошибка уведомления:', e.message));
}
