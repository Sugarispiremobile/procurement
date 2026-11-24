import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, download } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { STATUSES, todayStr } from '../constants.js';
import RequestCard from '../components/RequestCard.jsx';
import CountUp from '../components/CountUp.jsx';

function Stats() {
  const [s, setS] = useState(null);
  useEffect(() => { api.get('/stats').then(setS).catch(() => {}); }, []);
  if (!s) return null;
  const items = [['Всего заявок', s.total, ''], ['В работе', s.active, ''], ['Без ответственного', s.unassigned, s.unassigned ? 'hot' : ''], ['Срочных в работе', s.urgent_active, s.urgent_active ? 'hot' : ''], ['Просрочено', s.overdue, s.overdue ? 'bad' : '']];
  return (
    <div className="stats five">
      {items.map(([t, n, cls]) => <div className={`stat ${cls}`} key={t}><b><CountUp to={n} /></b><span>{t}</span></div>)}
    </div>
  );
}

const LIMIT = 20;

/** Очередь заявок. Все фильтры живут в адресной строке (B4): ссылкой можно поделиться, каждое действие — отдельная запись истории (набор текста поиска историю не засоряет). */
export default function RequestsPage() {
  const { user } = useAuth();
  const notify = useToast();
  const isBuyer = user.role !== 'employee';
  const [sp, setSp] = useSearchParams();
  const get = (k) => sp.get(k) ?? '';
  const [q, setQ] = useState(get('q'));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [categories, setCategories] = useState([]);
  const [departments, setDepartments] = useState([]);

  const page = Math.max(1, Number(get('page')) || 1);
  const update = (patch, { keepPage = false, replace = false } = {}) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) (v === '' || v == null || v === false ? next.delete(k) : next.set(k, v === true ? '1' : v));
    if (!keepPage) next.delete('page');
    setSp(next, { replace });
  };

  // Поле поиска следует за адресной строкой (переход по ссылке с другим ?q=, «назад»)
  const urlQ = get('q');
  useEffect(() => { setQ((cur) => (cur.trim() === urlQ ? cur : urlQ)); }, [urlQ]);

  // Поиск — с задержкой, чтобы не слать запрос на каждую букву
  useEffect(() => {
    if (q.trim() === get('q')) return undefined;
    const t = setTimeout(() => update({ q: q.trim() }, { replace: true }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    if (!isBuyer) return;
    api.get('/categories').then((d) => setCategories(d.items)).catch(() => {});
    api.get('/departments').then((d) => setDepartments(d.items)).catch(() => {});
  }, [isBuyer]);

  const qs = sp.toString();
  useEffect(() => {
    let live = true;
    setError('');
    const params = new URLSearchParams(qs);
    params.set('limit', LIMIT);
    api.get(`/requests?${params}`).then((d) => live && setData(d)).catch((e) => live && setError(e.full));
    return () => { live = false; };
  }, [qs]);

  const exportCsv = async () => {
    try {
      const params = new URLSearchParams(qs);
      params.delete('page');
      await download(`/requests/export.csv?${params}`, `zayavki-${todayStr()}.csv`);
    } catch (e) { notify(e.full, true); }
  };

  const filtersOn = ['status', 'q', 'assignee', 'category', 'department', 'urgent', 'overdue', 'from', 'to'].some((k) => get(k));
  const pages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;
  const assignee = get('assignee') || 'all';

  return (
    <>
      {isBuyer && <Stats />}
      <section>
        <div className="listhead">
          <h2>{isBuyer ? 'Очередь снабжения' : 'Мои заявки'}</h2>
          <div className="tools">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: номер, имя, позиция" aria-label="Поиск по заявкам" />
            {isBuyer && <button className="btn ghost sm" type="button" onClick={exportCsv}>⬇ CSV</button>}
            <Link className="btn sm" to="/requests/new">+ Новая заявка</Link>
          </div>
        </div>

        <div className="filters">
          {[{ k: '', t: 'Все' }, ...STATUSES].map((s) => (
            <button key={s.k} type="button" className="chip" aria-pressed={get('status') === s.k} onClick={() => update({ status: s.k })}>{s.t}</button>
          ))}
        </div>

        {isBuyer && (
          <div className="filterbar">
            <div className="view" role="group" aria-label="Ответственный">
              {[['all', 'Все'], ['me', 'Мои'], ['none', 'Без ответственного']].map(([k, t]) => (
                <button key={k} type="button" aria-pressed={assignee === k} onClick={() => update({ assignee: k === 'all' ? '' : k })}>{t}</button>
              ))}
            </div>
            <select aria-label="Категория" value={get('category')} onChange={(e) => update({ category: e.target.value })}>
              <option value="">Все категории</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select aria-label="Подразделение" value={get('department')} onChange={(e) => update({ department: e.target.value })}>
              <option value="">Все подразделения</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <label className="check"><input type="checkbox" checked={Boolean(get('urgent'))} onChange={(e) => update({ urgent: e.target.checked })} />Срочные</label>
            <label className="check"><input type="checkbox" checked={Boolean(get('overdue'))} onChange={(e) => update({ overdue: e.target.checked })} />Просроченные</label>
            <label className="datef">с <input type="date" aria-label="Создана с" value={get('from')} max={get('to') || undefined} onChange={(e) => update({ from: e.target.value })} /></label>
            <label className="datef">по <input type="date" aria-label="Создана по" value={get('to')} min={get('from') || undefined} onChange={(e) => update({ to: e.target.value })} /></label>
          </div>
        )}
        {filtersOn && <p className="meta"><button type="button" className="linkbtn" onClick={() => { setQ(''); setSp({}); }}>Сбросить все фильтры</button></p>}

        {error && <p className="urgent" role="alert">{error}</p>}
        {!data && !error && <p className="empty">Загрузка…</p>}
        {data && !data.requests.length && (
          <div className="empty">
            {filtersOn ? 'Ничего не найдено. Сбросьте фильтры или измените поиск.' : isBuyer ? 'Новые заявки появятся здесь.' : <>У вас пока нет заявок. <Link to="/requests/new">Создать первую</Link></>}
          </div>
        )}
        {data?.requests.map((r, i) => <RequestCard key={r.id} r={r} isBuyer={isBuyer} index={i} />)}

        {data && data.total > 0 && (
          <div className="pager" role="navigation" aria-label="Страницы">
            <span className="meta">Показано {data.requests.length} из {data.total}</span>
            <button className="btn ghost sm" type="button" disabled={page <= 1} onClick={() => update({ page: page - 1 }, { keepPage: true })}>← Назад</button>
            <span className="meta">Стр. {page} из {pages}</span>
            <button className="btn ghost sm" type="button" disabled={page >= pages} onClick={() => update({ page: page + 1 }, { keepPage: true })}>Вперёд →</button>
          </div>
        )}
      </section>
    </>
  );
}
