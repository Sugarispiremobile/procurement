import test from 'node:test';
import assert from 'node:assert/strict';
process.env.JWT_SECRET ??= 'test';
process.env.DATABASE_URL ??= 'postgres://x';
const { todayStr } = await import('../src/dates.js');

test('F5: «сегодня» считается в заданном часовом поясе, а не в поясе процесса', () => {
  const t = new Date('2026-11-16T22:30:00Z'); // в Алматы (UTC+5) уже 17-е
  assert.equal(todayStr(t, 'Asia/Almaty'), '2026-11-17');
  assert.equal(todayStr(t, 'UTC'), '2026-11-16');
});
