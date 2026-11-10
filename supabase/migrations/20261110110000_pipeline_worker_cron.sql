-- Server-side pipeline heartbeat.
--
-- Before running this migration:
--   1. Enable pg_cron and pg_net in Supabase if they are not already enabled.
--   2. Create the CRON_SECRET in Supabase Vault using the same value that is in
--      Vercel's CRON_SECRET environment variable:
--
--      select vault.create_secret('<same-value-as-vercel-CRON_SECRET>', 'CRON_SECRET');
--
-- This schedules the Lead Portal worker every minute, so imports, website
-- enrichment, signals and AI briefs continue when no browser tab is open.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (
    select 1 from cron.job where jobname = 'lead-portal-worker'
  ) then
    perform cron.unschedule('lead-portal-worker');
  end if;
end
$$;

select cron.schedule(
  'lead-portal-worker',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://lead-portal-9siz.vercel.app/api/worker/tick',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || coalesce(
          (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET'),
          ''
        ),
        'Content-Type',
        'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
  $cron$
);
