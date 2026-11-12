-- Autopilot heartbeat every 15 minutes. Requires the CRON_SECRET in Vault
-- with the same value as Vercel's CRON_SECRET.
-- create extension if not exists pg_cron;  -- enable in Supabase if needed
-- create extension if not exists pg_net;   -- enable in Supabase if needed

do $$
begin
  if exists (select 1 from cron.job where jobname = 'lead-portal-autopilot') then
    perform cron.unschedule('lead-portal-autopilot');
  end if;
end
$$;

select cron.schedule(
  'lead-portal-autopilot',
  '*/15 * * * *',
  $cron$
    select net.http_post(
      url := 'https://lead-portal-9siz.vercel.app/api/autopilot/tick',
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
