import { useRef, useState } from 'react';
import { api, download, upload } from '../api.js';
import { useToast } from '../context.jsx';
import { FILE_EXT, MAX_FILE, MAX_FILES, fmtDT, fmtSize } from '../constants.js';

/** Вложения (D1–D4): список, скачивание, удаление своих файлов, загрузка перетаскиванием. */
export default function Files({ requestId, files, onChange, canUpload, meId, closed }) {
  const notify = useToast();
  const input = useRef();
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async (list) => {
    let current = files;
    for (const f of list) {
      const ext = f.name.split('.').pop().toLowerCase();
      if (!FILE_EXT.includes(ext)) { notify(`«${f.name}»: допустимы pdf, jpg, png, webp, xlsx, docx`, true); continue; }
      if (f.size > MAX_FILE) { notify(`«${f.name}»: больше 10 МБ`, true); continue; }
      if (current.length >= MAX_FILES) { notify(`Не более ${MAX_FILES} файлов на заявку`, true); break; }
      setBusy(true);
      try {
        current = (await upload(`/requests/${requestId}/files`, f)).files;
        onChange(current);
        notify(`Загружен: ${f.name}`);
      } catch (e) { notify(e.full, true); } finally { setBusy(false); }
    }
  };

  const remove = async (f) => {
    if (!confirm(`Удалить файл «${f.original_name}»?`)) return;
    try {
      await api.del(`/requests/${requestId}/files/${f.id}`);
      onChange(files.filter((x) => x.id !== f.id));
    } catch (e) { notify(e.full, true); }
  };

  const open = (f) => download(`/requests/${requestId}/files/${f.id}`, f.original_name).catch((e) => notify(e.full, true));

  return (
    <div>
      <h3 style={{ fontSize: 13, marginTop: 20 }}>Файлы ({files.length}/{MAX_FILES})</h3>
      {files.length > 0 && (
        <ul className="filelist">
          {files.map((f) => (
            <li key={f.id}>
              <button type="button" className="linkbtn" onClick={() => open(f)}>📎 {f.original_name}</button>
              <span className="meta">{fmtSize(f.size_bytes)} · {f.uploaded_by_name} · {fmtDT(f.created_at)}</span>
              {f.uploaded_by === meId && !closed && <button type="button" className="x" aria-label={`Удалить ${f.original_name}`} onClick={() => remove(f)}>×</button>}
            </li>
          ))}
        </ul>
      )}
      {canUpload && files.length < MAX_FILES && (
        <div
          className={`dropzone${drag ? ' over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); send([...e.dataTransfer.files]); }}
        >
          {busy ? 'Загружаем…' : <>Перетащите файлы сюда или <button type="button" className="linkbtn" onClick={() => input.current.click()}>выберите</button></>}
          <small>pdf, jpg, png, webp, xlsx, docx · до 10 МБ · не более {MAX_FILES}</small>
          <input ref={input} type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.docx" onChange={(e) => { send([...e.target.files]); e.target.value = ''; }} />
        </div>
      )}
    </div>
  );
}
