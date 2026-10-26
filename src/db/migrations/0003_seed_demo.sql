-- Built-in public aliases. NULL expires_at marks them as never-expiring and
-- therefore stored as plain text, while all expiring rows are encrypted.
INSERT INTO aliases (word, content, secret, created_at, expires_at)
VALUES (
  'diamond-sutra',
  '一切有为法
如梦幻泡影
如露亦如电
应作如是观',
  NULL,
  CAST(strftime('%s', 'now') AS INTEGER),
  NULL
);
