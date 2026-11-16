// HTML берётся из собственных статических файлов проекта (src/docs), не от пользователей
export default function DocPage({ html }) {
  return <article className="doc" dangerouslySetInnerHTML={{ __html: html }} />;
}
