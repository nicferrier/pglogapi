CREATE OR REPLACE FUNCTION log_notify_hook(rec log) RETURNS log AS $log_hook$
begin
   -- notify the user
   PERFORM pg_notify('log', '{"id":' ||  rec.id || '}');
   RETURN rec;
end;
$log_hook$ LANGUAGE plpgsql;
