import { config } from './config.js';
import { newInviteToken, hashToken } from './auth.js';
import { sendMail } from './mailer.js';

/** Ссылка-приглашение (A2/A5). Прежние неиспользованные ссылки пользователя гасятся. */
export async function createInvite(db, user, { reset = false } = {}) {
  const token = newInviteToken();
  await db.query('UPDATE invites SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [user.id]);
  const { rows } = await db.query(
    `INSERT INTO invites (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3)) RETURNING expires_at`,
    [hashToken(token), user.id, config.inviteTtlHours],
  );
  const invite_url = `${config.appUrl}/invite/${token}`;
  return { invite_url, expires_at: rows[0].expires_at, send: () => sendMail({
    to: user.email,
    subject: reset ? 'Сброс пароля — заявки в снабжение' : 'Приглашение в сервис заявок в снабжение',
    text: `Здравствуйте, ${user.full_name}!\n\n${reset ? 'Администратор сбросил ваш пароль.' : 'Вас пригласили в сервис заявок в отдел снабжения.'}\nУстановите пароль по ссылке (действует ${config.inviteTtlHours} ч):\n${invite_url}\n`,
  }) };
}
