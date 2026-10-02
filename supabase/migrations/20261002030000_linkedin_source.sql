-- Provenance for company LinkedIn URLs: where each one came from.
-- Values: 'site' (found on the company's own pages) or 'search' (verified search result).

alter table public.organizations
  add column linkedin_source text;
