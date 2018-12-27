CREATE OR REPLACE FUNCTION log_notify_hook(rec log) RETURNS log AS $log_hook$
begin
   -- notify the user
   PERFORM pg_notify('log', jsonb_set(rec.data::jsonb, '{id}', (rec.id::text)::jsonb, true)::TEXT);
   RETURN rec;
end;
$log_hook$ LANGUAGE plpgsql;
