-- function to insert things   -*- mode: sql -*-

CREATE OR REPLACE FUNCTION log_insert(p_timestamp TIMESTAMP WITH TIME ZONE, p_data JSON)
RETURNS INTEGER AS $log_insert$
declare
v_year CONSTANT TEXT := date_part('year', p_timestamp);
v_month CONSTANT TEXT := date_part('month', p_timestamp); --- needs to be 08 not 8
v_year_month CONSTANT TEXT := v_year || v_month;
v_table_name CONSTANT TEXT := 'log_' || v_year_month;
v_schema_name TEXT := 'parts';
v_fq_table_name TEXT := v_schema_name || '.' || v_table_name;
v_result_id INTEGER;
v_insert_statement TEXT;
begin
    -- we have to make it if it's not there
    EXECUTE format($create$
                   CREATE TABLE IF NOT EXISTS %I.%I
                   (id INTEGER, d timestamp with time zone, data JSON)
                   INHERITS (public.log);
                   $create$, v_schema_name, v_table_name);
    -- Now turn on the trigger for that table
    PERFORM create_or_replace_trigger(
             v_schema_name, v_table_name, 'log_actions', 'log_trigger_' || v_year_month
    );
    -- now we've definitely got a table, insert the data
    v_insert_statement := format($insert$
                                 INSERT INTO parts.%I (id, d, data) VALUES ($1, $2, $3)
                                 RETURNING id;
                                 $insert$, v_table_name);
    execute v_insert_statement
    into v_result_id
    using nextval('log_id'), p_timestamp, p_data;
    -- and return it
    RETURN v_result_id;
end;
$log_insert$ LANGUAGE plpgsql;

-- End

