--  log before trigger to dispatch to partition  -*- mode: sql -*-

CREATE OR REPLACE FUNCTION log_insert_trigger() RETURNS trigger AS $log_insert_trigger$
declare
v_year CONSTANT TEXT := date_part('year', NEW.d);
v_month_val CONSTANT TEXT := date_part('month', NEW.d);
v_month CONSTANT TEXT := lpad(v_month_val, 2, '0');
v_start_date CONSTANT DATE := date(format('%s-%s-01', v_year, v_month));
v_end_date CONSTANT TEXT := (v_start_date + interval '1 month') - interval '1 day';
v_year_month CONSTANT TEXT := v_year || v_month;
v_table_name CONSTANT TEXT := 'log_' || v_year_month;
v_schema_name TEXT := 'parts';
begin
    RAISE NOTICE 'log_insert_trigger % (%,%,%)', v_table_name, NEW.id, NEW.d, NEW.data;
    -- we have to make it if it's not there
    EXECUTE format($create$
                   CREATE TABLE IF NOT EXISTS %I.%I (
                     check (d between %L and %L)
                   ) INHERITS (log);
                   $create$,
                   v_schema_name, v_table_name,
                   v_start_date, v_end_date);
    -- now we can insert into that table we made
    EXECUTE format($insert$
            INSERT INTO parts.%I (id, d, data)
            VALUES ($1, $2, $3)
            RETURNING id;
            $insert$, v_table_name)
    using NEW.id, NEW.d, NEW.data;
    RETURN NULL;
end;
$log_insert_trigger$ LANGUAGE plpgsql;

-- End
