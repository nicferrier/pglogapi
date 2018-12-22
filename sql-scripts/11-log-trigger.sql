--  log trigger to notify updates  -*- mode: sql -*-

CREATE OR REPLACE FUNCTION log_trigger() RETURNS trigger AS $log_trigger$
begin
    -- notify the user
    PERFORM pg_notify('log', jsonb_set(NEW.data::jsonb, '{id}', (NEW.id::text)::jsonb, true)::TEXT);
    RETURN NEW;
end;
$log_trigger$ LANGUAGE plpgsql;

-- End
