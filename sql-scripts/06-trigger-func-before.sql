CREATE OR REPLACE FUNCTION create_or_replace_trigger_before(
    schema_name TEXT,
    table_name TEXT,
    trigger_name TEXT,
    function_name TEXT
)
RETURNS void AS $$
begin
    RAISE NOTICE 'trigger before on table: % and trigger: %', table_name, trigger_name;
    PERFORM tgname FROM pg_trigger WHERE tgname = trigger_name;
    if NOT FOUND then
        RAISE NOTICE 'setting trigger % on %.%', trigger_name, schema_name, table_name;
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
