-- Админ может удалить файл заявки; событие пишется в историю
ALTER TABLE status_history DROP CONSTRAINT IF EXISTS status_history_event_check;
ALTER TABLE status_history ADD CONSTRAINT status_history_event_check
  CHECK (event IN ('status', 'edited', 'assigned', 'file_deleted'));
