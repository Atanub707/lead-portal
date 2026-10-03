-- Backfill the decision-maker flag for existing contacts whose title carries a
-- leadership word, matching the same rule the paste flow applies to new people.

update public.contacts
set is_decision_maker = true
where is_decision_maker = false
  and title ~* '(founder|co-?founder|ceo|cto|coo|cfo|cmo|owner|president|partner|head of|director)';
