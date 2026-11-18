import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../context.jsx';

function Row({ item, path, onChange }) {
  const notify = useToast();
  const [name, setName] = useState(item.name);
  const save = async (body, msg) => {
    try { onChange(await api.patch(`${path}/${item.id}`, body)); notify(msg); } catch (e) { notify(e.full, true); }
  };
  return (
    <li className={`dictrow${item.is_archived ? ' archived' : ''}`}>
      <input value={name} maxLength={100} aria-label={`Название: ${item.name}`} onChange={(e) => setName(e.target.value)} />
      <button className="btn ghost sm" type="button" disabled={!name.trim() || name.trim() === item.name} onClick={() => save({ name: name.trim() }, 'Переименовано')}>Переименовать</button>
      <button className="btn ghost sm" type="button" onClick={() => save({ is_archived: !item.is_archived }, item.is_archived ? 'Возвращено из архива' : 'В архиве')}>
        {item.is_archived ? 'Вернуть' : 'В архив'}
      </button>
    </li>
  );
}

function Dictionary({ title, path }) {
  const notify = useToast();
  const [items, setItems] = useState(null);
  const [name, setName] = useState('');

  useEffect(() => {
    api.get(`${path}/all`).then((d) => setItems(d.items)).catch((e) => notify(e.full, true));
  }, [path, notify]);

  const sort = (a) => a.sort((x, y) => x.name.localeCompare(y.name, 'ru'));
  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const created = await api.post(path, { name: name.trim() });
      setItems(sort([...items, created]));
      setName('');
      notify('Добавлено');
    } catch (ex) { notify(ex.full, true); }
  };

  return (
    <section className="panel">
      <h2>{title}</h2>
      <p className="meta">Архивные элементы скрыты из выбора, но остаются в старых заявках.</p>
      {!items ? <p className="empty">Загрузка…</p> : (
        <ul className="dictlist">
          {items.map((i) => <Row key={`${i.id}-${i.name}-${i.is_archived}`} item={i} path={path} onChange={(u) => setItems(sort(items.map((x) => (x.id === u.id ? u : x))))} />)}
        </ul>
      )}
      <form className="acts" onSubmit={add}>
        <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Новое название" aria-label={`${title}: новое название`} />
        <button className="btn sm">Добавить</button>
      </form>
    </section>
  );
}

export default function AdminDictionaries() {
  return (
    <>
      <Dictionary title="Подразделения" path="/departments" />
      <Dictionary title="Категории закупок" path="/categories" />
    </>
  );
}
