--  log trigger to notify updates  -*- mode: sql -*-

CREATE OR REPLACE FUNCTION log_trigger() RETURNS trigger AS $log_trigger$
declare
   hook_row RECORD;
   v_exists BOOLEAN;
begin
   -- should we execute hooks?
   SELECT EXISTS (
     SELECT 1
     FROM information_schema.tables 
     WHERE table_schema = 'public'
       AND table_name = 'log_hook'
   ) into v_exists;
   RAISE NOTICE 'hooks exist? %', v_exists;
   if v_exists then
     -- loop round the hooks
     for hook_row in SELECT * FROM log_hook
     loop
        RAISE NOTICE 'applying hook % to %', hook_row.hook_name, hook_row.function_name;
        EXECUTE format($apply$
                       SELECT %I(%L);
                       $apply$,
                       hook_row.function_name, NEW);
     end loop;
   else
     RAISE NOTICE 'No log_hooks found';
   end if;
   RETURN NEW;
end;
$log_trigger$ LANGUAGE plpgsql;

-- End
