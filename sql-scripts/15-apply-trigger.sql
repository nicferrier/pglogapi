-- apply the tigger to the log table  -*- mode: sql -*-

SELECT create_or_replace_trigger_before('public', 'log', 'log_partition_handle', 'log_insert_trigger');

-- end

