import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../context.jsx';
import { todayStr } from '../constants.js';

const emptyItem = () => ({ name: '', quantity: 1, unit: 'шт.' });

export default function RequestForm() {
  const { id } = useParams(); // есть id — редактирование
  const nav = useNavigate();
  const notify = useToast();
  const [categories, setCategories] = useState([]);
  const [loaded, setLoaded] = useState(!id);
  const [orig, setOrig] = useState(null);
  const [f, setF] = useState({ category_id: '', is_urgent: false, due_date: '', budget: '', justification: '' });
  const [items, setItems] = useState([emptyItem()]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/categories').then((d) => {
      setCategories(d.items);
      setF((p) => (p.category_id ? p : { ...p, category_id: d.items[0]?.id ?? '' }));
    }).catch((e) => setErr(e.full));
  }, []);

  useEffect(() => {
    if (!id) return;
    api.get(`/requests/${id}`).then((r) => {
      if (r.status !== 'new') { setErr('Заявку можно менять только в статусе «Новая»'); return; }
      setOrig(r);
      setF({ category_id: r.category_id, is_urgent: r.is_urgent, due_date: r.due_date ?? '', budget: r.budget ?? '', justification: r.justification });
      setItems(r.items.map(({ name, quantity, unit }) => ({ name, quantity, unit })));
    }).catch((e) => setErr(e.full)).finally(() => setLoaded(true));
  }, [id]);

  const setItem = (i, k, v) => setItems(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));

  const submit = async (e) => {
    e.preventDefault();
    const clean = items.map((i) => ({ name: i.name.trim(), quantity: Number(i.quantity), unit: i.unit.trim() || 'шт.' })).filter((i) => i.name);
    if (!clean.length) return setErr('Добавьте хотя бы одну позицию.');
    if (clean.some((i) => !Number.isInteger(i.quantity) || i.quantity < 1)) return setErr('Количество должно быть целым числом больше 0.');
    if (!f.justification.trim()) return setErr('Напишите обоснование — оно ускоряет согласование.');
    if (f.budget !== '' && Number(f.budget) < 0) return setErr('Сумма не может быть отрицательной.');
    if (f.due_date && f.due_date < todayStr() && f.due_date !== orig?.due_date) return setErr('Дата «нужно к» не может быть в прошлом.');
    setErr(''); setBusy(true);
    const body = {
      category_id: Number(f.category_id), is_urgent: f.is_urgent,
      due_date: f.due_date || null, budget: f.budget === '' ? null : Number(f.budget),
      justification: f.justification.trim(), items: clean,
    };
    try {
      const r = id ? await api.put(`/requests/${id}`, body) : await api.post('/requests', body);
      notify(id ? `Заявка №${r.id} обновлена` : `Заявка №${r.id} отправлена`);
      nav(`/requests/${r.id}`);
    } catch (ex) {
      setErr(ex.full);
    } finally { setBusy(false); }
  };

  if (!loaded) return <p className="empty">Загрузка…</p>;

  return (
    <form className="panel" onSubmit={submit}>
      <h2>{id ? `Редактирование заявки №${id}` : 'Новая заявка'}</h2>
      <div className="grid">
        <div>
          <label htmlFor="cat">Категория</label>
          <select id="cat" value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })} required>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="prio">Срочность</label>
          <select id="prio" value={f.is_urgent ? '1' : '0'} onChange={(e) => setF({ ...f, is_urgent: e.target.value === '1' })}>
            <option value="0">Обычная</option><option value="1">Срочная</option>
          </select>
        </div>
        <div>
          <label htmlFor="due">Нужно к дате</label>
          <input id="due" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
        </div>
        <div>
          <label htmlFor="budget">Ориентировочная сумма, ₽</label>
          <input id="budget" type="number" min="0" step="1" inputMode="numeric" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} />
        </div>
        <div className="full">
          <label>Позиции</label>
          {items.map((it, i) => (
            <div className="row" key={i}>
              <input placeholder="Наименование" aria-label="Наименование" maxLength={120} value={it.name} onChange={(e) => setItem(i, 'name', e.target.value)} />
              <input type="number" min="1" step="1" aria-label="Количество" value={it.quantity} onChange={(e) => setItem(i, 'quantity', e.target.value)} />
              <input aria-label="Единица" maxLength={12} value={it.unit} onChange={(e) => setItem(i, 'unit', e.target.value)} />
              <button type="button" className="x" aria-label="Удалить позицию" onClick={() => items.length > 1 && setItems(items.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <button type="button" className="btn ghost sm" onClick={() => setItems([...items, emptyItem()])}>Добавить позицию</button>
        </div>
        <div className="full">
          <label htmlFor="why">Обоснование</label>
          <textarea id="why" maxLength={1000} placeholder="Зачем это нужно и что будет без закупки" value={f.justification} onChange={(e) => setF({ ...f, justification: e.target.value })} />
        </div>
      </div>
      <p className="urgent" role="alert" style={{ margin: '10px 0 0' }}>{err}</p>
      <div className="btnrow">
        <button className="btn" disabled={busy}>{id ? 'Сохранить изменения' : 'Отправить заявку'}</button>
        <Link className="btn ghost" to={id ? `/requests/${id}` : '/requests'}>Отмена</Link>
      </div>
    </form>
  );
}
