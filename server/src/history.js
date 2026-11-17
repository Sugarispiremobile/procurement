const fmtItems = (items) => items.map((i) => `${i.name} — ${i.quantity} ${i.unit}`).join('; ');

/** Краткое описание правки заявки для истории. Пустая строка — ничего не изменилось. */
export function describeEdit(before, after) {
  const parts = [];
  if (before.category_id !== after.category_id) parts.push('категория');
  if (before.is_urgent !== after.is_urgent) parts.push(`срочность: ${after.is_urgent ? 'срочная' : 'обычная'}`);
  if ((before.due_date ?? null) !== (after.due_date ?? null)) parts.push(`срок: ${before.due_date ?? '—'} → ${after.due_date ?? '—'}`);
  if ((before.budget ?? null) !== (after.budget ?? null)) parts.push(`сумма: ${before.budget ?? '—'} → ${after.budget ?? '—'}`);
  if (before.justification !== after.justification) parts.push('обоснование');
  const a = fmtItems(before.items);
  const b = fmtItems(after.items);
  if (a !== b) parts.push(`позиции: ${a} → ${b}`);
  const text = parts.join('; ');
  return text.length > 1000 ? `${text.slice(0, 997)}…` : text;
}
