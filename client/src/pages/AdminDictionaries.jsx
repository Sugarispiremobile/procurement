import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../context.jsx';

function Dictionary({ title, path }) {
  const notify = useToast();
  const [items, setItems] = useState(null);
  const [name, setName] = useState('');

  useEffect(() => {
    api.get(path).then((d) => setItems(d.items)).catch((e) => notify(e.full, true));
  }, [path, notify]);

  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const created = await api.post(path, { name: name.trim() });
      setItems([...items, created].sort((a, b) => a.name.localeCompare(b.name, 'ru')));
      setName('');
      notify('Добавлено');
    } catch (ex) { notify(ex.full, true); }
  };

  return (
    <section className="panel">
      <h2>{title}</h2>
      {!items ? <p className="empty">Загрузка…</p> : <ul className="items">{items.map((i) => <li key={i.id}>{i.name}</li>)}</ul>}
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
