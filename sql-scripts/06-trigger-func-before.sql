CREATE OR REPLACE FUNCTION create_or_replace_trigger_before(
    schema_name TEXT,
    table_name TEXT,
    trigger_name TEXT,
    function_name TEXT
)
RETURNS void AS $$
begin
    PERFORM tgname FROM pg_trigger WHERE tgname = trigger_name;
    if NOT FOUND then
        EXECUTE format($create_trigger$
                       CREATE TRIGGER %I
                       BEFORE INSERT ON %I.%I
                       FOR EACH ROW EXECUTE PROCEDURE %I();
                       $create_trigger$,
                       trigger_name, schema_name, table_name, function_name);
    end if;
end;
$$ LANGUAGE plpgsql;

-- End
