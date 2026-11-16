import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, download } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { STATUSES, todayStr } from '../constants.js';
import RequestCard from '../components/RequestCard.jsx';
import CountUp from '../components/CountUp.jsx';

function Stats() {
  const [s, setS] = useState(null);
  useEffect(() => { api.get('/stats').then(setS).catch(() => {}); }, []);
  if (!s) return null;
  const items = [['Всего заявок', s.total, ''], ['В работе', s.active, ''], ['Срочных в работе', s.urgent_active, s.urgent_active ? 'hot' : ''], ['Просрочено', s.overdue, s.overdue ? 'bad' : '']];
  return (
    <div className="stats">
      {items.map(([t, n, cls]) => <div className={`stat ${cls}`} key={t}><b><CountUp to={n} /></b><span>{t}</span></div>)}
    </div>
  );
}

export default function RequestsPage() {
  const { user } = useAuth();
  const notify = useToast();
  const isBuyer = user.role !== 'employee';
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState(() => { try { return localStorage.getItem('procurement-view') || 'list'; } catch { return 'list'; } });
  const changeView = (v) => { setView(v); try { localStorage.setItem('procurement-view', v); } catch { /* ignore */ } };
  const board = isBuyer && view === 'board';
  const [list, setList] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let live = true;
    setError('');
    api.get(`/requests?q=${encodeURIComponent(debounced)}`)
      .then((d) => live && setList(d.requests))
      .catch((e) => live && setError(e.full));
    return () => { live = false; };
  }, [debounced]);

  const counts = useMemo(() => {
    const c = { all: list?.length ?? 0 };
    for (const s of STATUSES) c[s.k] = list?.filter((r) => r.status === s.k).length ?? 0;
    return c;
  }, [list]);
  const shown = list?.filter((r) => filter === 'all' || r.status === filter) ?? [];

  const exportCsv = async () => {
    try {
      const params = new URLSearchParams({ q: debounced });
      if (filter !== 'all') params.set('status', filter);
      await download(`/requests/export.csv?${params}`, `zayavki-${todayStr()}.csv`);
    } catch (e) { notify(e.full, true); }
  };

  return (
    <>
      {isBuyer && <Stats />}
      <section>
        <div className="listhead">
          <h2>{isBuyer ? 'Очередь снабжения' : 'Мои заявки'}</h2>
          <div className="tools">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: номер, имя, позиция" aria-label="Поиск по заявкам" />
            {isBuyer && (
              <div className="view" role="group" aria-label="Вид">
                <button type="button" aria-pressed={view === 'list'} onClick={() => changeView('list')}>Список</button>
                <button type="button" aria-pressed={view === 'board'} onClick={() => changeView('board')}>Доска</button>
              </div>
            )}
            {isBuyer && <button className="btn ghost sm" type="button" onClick={exportCsv}>⬇ CSV</button>}
            {!isBuyer && <Link className="btn sm" to="/requests/new">+ Новая заявка</Link>}
          </div>
        </div>
        {!board && <div className="filters">
          {[{ k: 'all', t: 'Все' }, ...STATUSES].map((s) => (
            <button key={s.k} type="button" className="chip" aria-pressed={filter === s.k} onClick={() => setFilter(s.k)}>
              {s.t}<em>{counts[s.k]}</em>
            </button>
          ))}
        </div>}
        {error && <p className="urgent" role="alert">{error}</p>}
        {list === null && !error && <p className="empty">Загрузка…</p>}
        {list && !board && !shown.length && (
          <div className="empty">
            {debounced || filter !== 'all' ? 'Ничего не найдено. Сбросьте фильтр или поиск.' : isBuyer ? 'Новые заявки появятся здесь.' : <>У вас пока нет заявок. <Link to="/requests/new">Создать первую</Link></>}
          </div>
        )}
        {board ? (
          list && (
            <div className="board">
              {STATUSES.map((st) => {
                const col = list.filter((r) => r.status === st.k);
                return (
                  <div className="col" key={st.k} style={{ '--st': st.c }}>
                    <h3>{st.t}<span>{col.length}</span></h3>
                    {col.map((r, i) => <RequestCard key={r.id} r={r} isBuyer={isBuyer} index={i} />)}
                  </div>
                );
              })}
            </div>
          )
        ) : shown.map((r, i) => <RequestCard key={r.id} r={r} isBuyer={isBuyer} index={i} />)}
      </section>
    </>
  );
}
