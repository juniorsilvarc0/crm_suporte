do $$
declare
  table_record record;
begin
  for table_record in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format(
      'alter table %I.%I disable row level security',
      table_record.schemaname,
      table_record.tablename
    );

    begin
      execute format(
        'alter publication supabase_realtime add table %I.%I',
        table_record.schemaname,
        table_record.tablename
      );
    exception
      when duplicate_object then
        null;
      when undefined_object then
        null;
    end;
  end loop;
end $$;
