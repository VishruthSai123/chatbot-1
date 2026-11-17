-- Enable Row Level Security on every existing public table.
--
-- The application connects through the direct Postgres pooler as the
-- `postgres` role, which has BYPASSRLS. Supabase's public `anon` and
-- `authenticated` roles do not. With RLS enabled and no permissive policies,
-- the public Data API can no longer read or write these tables even when the
-- public anon key is known.
--
-- The app does not use the Supabase Data API for database access; it uses the
-- service-role key only for Storage. Future tables must also enable RLS.

DO $$
DECLARE
  table_record record;
BEGIN
  FOR table_record IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      table_record.tablename
    );
  END LOOP;
END $$;
