-- mode: sql

SELECT log_insert(now(), $1);

-- INSERT INTO log (id, d, data)
-- VALUES (nextval('log_id'), now(), $1)
-- RETURNING id;

-- end
