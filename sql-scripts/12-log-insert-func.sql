-- function to insert things   -*- mode: sql -*-

CREATE OR REPLACE FUNCTION log_insert(p_timestamp TIMESTAMP WITH TIME ZONE, p_data JSON)
RETURNS INTEGER AS $log_insert$
declare
v_year CONSTANT TEXT := date_part('year', p_timestamp);
v_month_val CONSTANT TEXT := date_part('month', p_timestamp);
v_month CONSTANT TEXT := lpad(v_month_val, 2, '0');
v_start_date CONSTANT DATE := date(format('%s-%s-01', v_year, v_month));
v_end_date CONSTANT TEXT := (v_start_date + interval '1 month') - interval '1 day';
v_year_month CONSTANT TEXT := v_year || v_month;
v_table_name CONSTANT TEXT := 'log_' || v_year_month;
v_schema_name TEXT := 'parts';
v_result_id INTEGER;
begin
    -- we have to make it if it's not there
    EXECUTE format($create$
                   CREATE TABLE IF NOT EXISTS %I.%I PARTITION OF log
                   FOR VALUES FROM (%L) TO (%L);
                   $create$,
                   v_schema_name, v_table_name,
                   v_start_date, v_end_date);
    -- Now turn on the trigger for that table
    PERFORM create_or_replace_trigger(
        v_schema_name, v_table_name, 'log_actions' || v_year_month, 'log_trigger' 
    );
    -- now we've definitely got a table, insert the data
    execute format($insert$
            INSERT INTO parts.%I (id, d, data) VALUES ($1, $2, $3)
            RETURNING id;
            $insert$, v_table_name)
    into v_result_id
    using nextval('log_id'), p_timestamp, p_data;
    -- and return it
    RETURN v_result_id;
end;
$log_insert$ LANGUAGE plpgsql;

-- End

