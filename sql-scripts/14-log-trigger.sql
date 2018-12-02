--  log trigger to notify updates  -*- mode: sql -*-

CREATE OR REPLACE FUNCTION log_trigger() RETURNS trigger AS $log_trigger$
begin
    -- notify the user
    PERFORM pg_notify('log', NEW.data::TEXT);
    RETURN NULL;
end;
$log_trigger$ LANGUAGE plpgsql;

-- End
