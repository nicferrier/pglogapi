SELECT *
FROM pg_tables 
WHERE schemaname NOT IN (
  'information_schema',
  'pg_catalog'
);
