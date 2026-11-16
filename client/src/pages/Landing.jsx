/** Левая «витринная» часть страниц входа и регистрации. */
export default function Landing({ children }) {
  return (
    <div className="landing">
      <section className="hero">
        <h1>Нужно купить? <br />Подайте <em>заявку</em>, <u>отследите</u> путь.</h1>
        <p>Один сервис вместо чатов и таблиц: сотрудник описывает потребность, снабжение ведёт её от согласования до закупки, а вы видите каждый шаг.</p>
        <div className="pills">
          <span className="pill">📝 Заявка за минуту</span>
          <span className="pill">🚚 Статус в реальном времени</span>
          <span className="pill">📊 Статистика для снабжения</span>
        </div>
        <div className="floaters" aria-hidden="true">
          <div className="fl">№1001 · Канцелярия<small>На согласовании</small></div>
          <div className="fl">№1002 · Оборудование<small>В закупке · срочно</small></div>
          <div className="fl">№1003 · Услуги<small>Выполнена ✓</small></div>
        </div>
      </section>
      {children}
    </div>
  );
}
