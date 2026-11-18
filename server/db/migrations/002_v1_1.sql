-- 002: версия 1.1 — доступ, ответственный, комментарии, вложения, расширенная история.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active     BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_email  BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL; -- NULL до принятия приглашения

CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_invites_user ON invites(user_id);

ALTER TABLE categories  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE requests ADD COLUMN IF NOT EXISTS assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_requests_assignee ON requests(assignee_id);
CREATE INDEX IF NOT EXISTS idx_requests_created  ON requests(created_at);

CREATE TABLE IF NOT EXISTS request_comments (
  id         SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'rejection')),
  body       TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comments_request ON request_comments(request_id);

-- C1: комментарии неизменяемы на уровне БД; каскадное удаление вместе с заявкой разрешено
CREATE OR REPLACE FUNCTION forbid_comment_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM requests WHERE id = OLD.request_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Комментарии нельзя изменять или удалять' USING ERRCODE = '42501';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_comment_immutable ON request_comments;
CREATE TRIGGER trg_comment_immutable BEFORE UPDATE OR DELETE ON request_comments
  FOR EACH ROW EXECUTE FUNCTION forbid_comment_change();

CREATE TABLE IF NOT EXISTS request_files (
  id            SERIAL PRIMARY KEY,
  request_id    INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  uploaded_by   INTEGER NOT NULL REFERENCES users(id),
  stored_name   TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL CHECK (size_bytes > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_files_request ON request_files(request_id);

ALTER TABLE status_history ALTER COLUMN new_status DROP NOT NULL;
ALTER TABLE status_history ADD COLUMN IF NOT EXISTS event TEXT NOT NULL DEFAULT 'status'
  CHECK (event IN ('status', 'edited', 'assigned'));
ALTER TABLE status_history ADD COLUMN IF NOT EXISTS details JSONB;

-- C5: buyer_comment → первый комментарий, затем столбец удаляется
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'requests' AND column_name = 'buyer_comment') THEN
    INSERT INTO request_comments (request_id, author_id, kind, body, created_at)
    SELECT r.id,
           COALESCE(
             (SELECT h.changed_by FROM status_history h
               WHERE h.request_id = r.id AND h.changed_by <> r.author_id ORDER BY h.id DESC LIMIT 1),
             (SELECT u.id FROM users u WHERE u.role IN ('buyer', 'admin') ORDER BY u.id LIMIT 1),
             r.author_id),
           CASE WHEN r.status = 'rejected' THEN 'rejection' ELSE 'comment' END,
           left(btrim(r.buyer_comment), 1000),
           r.updated_at
      FROM requests r
     WHERE btrim(r.buyer_comment) <> '';
    ALTER TABLE requests DROP COLUMN buyer_comment;
  END IF;
END $$;
