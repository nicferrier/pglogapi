CREATE OR REPLACE FUNCTION create_or_replace_hook(
    p_schema_name TEXT,
    p_table_name TEXT,
    p_hook_name TEXT,
    p_function_name TEXT
)
RETURNS void AS $hook_func$
begin
    -- FIXME: there needs to be a trigger function for each schema/table
    -- that are needed for hooks. This could attach the trigger to do that
    -- whenever it finds the trigger is missing... but it does not right
    -- now.
    CREATE SEQUENCE if not exists log_hook_id;
    CREATE TABLE if not exists log_hook (id INTEGER,
                                      hook_name TEXT,
                                      function_name TEXT,
                                      target_schema TEXT,
                                      target_table TEXT);
    PERFORM p_hook_name FROM log_hook WHERE hook_name = p_hook_name;
    if NOT FOUND then
        RAISE NOTICE 'inserting hook % into hooks', p_hook_name;
        INSERT INTO log_hook (id,
                              hook_name, function_name,
                              target_schema, target_table)
        VALUES (nextval('log_hook_id'),
                p_hook_name, p_function_name,
                p_schema_name, p_table_name);
    else
        UPDATE log_hook
        SET
        function_name = p_function_name,
        target_schema = p_schema_name,
        target_table = p_table_name
        WHERE hook_name = p_hook_name;
    end if;
end;
$hook_func$ LANGUAGE plpgsql;

-- End
