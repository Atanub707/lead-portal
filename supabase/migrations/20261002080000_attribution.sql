-- Attribution: who added what. organizations.created_by already exists (Clerk user id);
-- contacts gain the same column, and pasted companies are backfilled from their
-- earliest enrichment run (which recorded the creator).

alter table public.contacts add column created_by text;

update public.organizations o
set created_by = r.created_by
from (
  select distinct on (org_id) org_id, created_by
  from public.enrichment_runs
  where created_by is not null
  order by org_id, created_at asc
) r
where o.id = r.org_id
  and o.created_by is null;
