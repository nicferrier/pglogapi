-- The main log table

CREATE SEQUENCE IF NOT EXISTS log_id;

CREATE TABLE IF NOT EXISTS log (
id INTEGER,
d timestamp with time zone,
data JSON
) PARTITION BY RANGE (d);

CREATE SCHEMA IF NOT EXISTS parts;

-- End
