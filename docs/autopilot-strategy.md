# Lead Portal Autopilot: Strategy, Architecture and Guardrails

Status: strategy draft  
Prepared: 8 November 2026  
Goal: an always-on AI agent that discovers leads, researches them, qualifies them,
drafts personalized outreach, sends within a pre-approved mandate, handles replies,
and improves from outcomes — with a single Autopilot switch and a hard stop.

---

## 1. The core decision

A 24/7 cold-email agent is possible, but "automatic" cannot mean "unbounded".

The correct model is a **bounded autopilot**:

- the human approves a **mandate**, not every email;
- the mandate defines who can be contacted, from which domain, in which regions,
  with what offer, at what volume, and for how long;
- a deterministic policy engine — not the language model — decides whether a specific
  email may be sent;
- the agent runs continuously, but sending happens only inside the approved window;
- the agent pauses automatically on risk signals and can be stopped instantly.

This preserves the existing human-approved send-coin architecture while allowing
mailing in your absence. The approval moves from "approve this email" to
"approve this bounded campaign policy".

Recommended rollout:

1. **Autopilot Assist** — agent discovers, researches, scores and drafts; you approve
   batches (or the day's queue). Best for the first 2–4 weeks.
2. **Bounded Autopilot** — after warm-up and a clean review period, auto-send only
   inside the mandate and only for low-risk segments.
3. **Adaptive Autopilot** — the agent uses reply outcomes to improve targeting and
   messaging, but cannot widen its own mandate.

Do not start with full autonomy on a new domain.

---

## 2. What runs 24/7

"24/7" applies to the **supervisor and workers**, not to sending volume.

- The supervisor wakes on a schedule and checks state, budget, replies, bounces,
  domain health, suppression and the pause switch.
- Discovery, enrichment, signal scans and reply classification run in queues.
- Drafting runs in batch, ahead of the sending window.
- Sending is controlled by the existing send queue, now fed by an autopilot mandate.
- If nothing is eligible, the agent stops; it does not invent leads or sends.

Daily loop (workspace local time):

```text
00:10  Reconcile: replies, bounces, complaints, suppressions, domain health
00:20  Plan the day against the mandate and current pipeline inventory
00:30  Discover new companies if inventory is below the target
00:45  Enrich websites, extract contacts/emails/LinkedIn, scan signals
01:30  Score and qualify; reject exhausted or ineligible companies
02:00  Draft emails for the next sending window
09:30  Send window opens; queue sends with human-paced gaps
       Every minute: check replies/suppression and stop affected sequences
17:30  Send window closes; mark unsent work for the next window
18:00  Measure outcomes; update learning signals; write the audit report
```

The agent must be event-driven and idempotent. It must never run an infinite loop.

---

## 3. Agent roles

| Agent | Responsibility | Allowed to send? |
|---|---|---|
| Scout | Discover companies using Crunchbase and approved sources; dedupe | No |
| Researcher | Website research, people, emails, LinkedIn, signals | No |
| Qualifier | ICP fit, intent, contactability, exclusions, score | No |
| Writer | Personalized first-touch and follow-up drafts | No |
| Policy engine | Deterministic final send gate | **Yes, only here** |
| Sender | Schedule/send approved messages; update threads | Only through policy engine |
| Inbox agent | Classify replies, stop sequences, draft responses | No (sends replies only under rules) |
| Analyst | Track outcomes, A/B results, quality, cost | No |
| Supervisor | Budget, pause, retries, kill switch, escalation | No |

The LLM never talks to SMTP directly. It proposes; the policy engine decides. Every
decision is written to an audit log with the reason.

Existing components to reuse:

- Copilot planner/executor and run state;
- website enrichment (`researchWebsite` / `enrichCompanyFromWebsite`);
- signal scans, scoring and ICP;
- recipient classifier and email quality checks;
- send coins, scheduled queue, suppression, stop-on-reply;
- campaign/sequence machinery for follow-ups;
- activity log for audit.

---

## 4. Autopilot mandate

The mandate is the human approval. It is explicit, versioned and revocable.

Required fields:

```text
workspace_id
status: draft | armed | paused | stopped | expired
sending_identity (domain / mailbox)
offer_id + approved value proposition
ICP: industries, headcount, geography, signals, minimum score
allowed_regions: US only initially; EU/UK/Canada/Australia require legal review
excluded_companies / excluded_domains / excluded_keywords
daily_cap (start 10, warm up to 30)
weekly_cap
per_domain_cap = 1
send_window + timezone + weekdays
approval_mode: review_first | auto_after_warmup
first_n_manual_reviews = 20
quality_threshold = 90/100
minimum_email_confidence = verified or high-confidence found
follow_up_policy: max steps, gap, stop on reply/opt-out
monthly_budget_caps: search, AI, email
start_at / end_at
```

The mandate is displayed as a plain-English summary before arming. Changing the offer,
region set, sending domain or cap requires re-approval.

---

## 5. Hard send gate

The policy engine blocks a send unless **all** of these are true:

1. Mandate is armed and inside its dates.
2. Sending identity is authenticated (SPF, DKIM, DMARC) and domain health is green.
3. Recipient is in an allowed region and matches the approved ICP.
4. Email is business-relevant and saved for that company (no guessed addresses).
5. No suppression, opt-out, complaint, bounce or prior reply.
6. No prior outbound to the company within the cooldown (default 30 days).
7. No other scheduled send to the same domain today.
8. Daily/weekly caps and warm-up limits are respected.
9. Inside the local send window and weekday schedule.
10. Draft quality ≥ threshold; no links/attachments/HTML on first contact; no spam
    phrases; no invented claims; clear sender identity.
11. Compliance footer present: legal business name, postal address, and a clear
    "reply STOP" opt-out (or approved unsubscribe mechanism).
12. No open incident, complaint spike, bounce spike, or manual pause.
13. The email was not generated from a prohibited data source.

The gate is deterministic and unit-tested. The LLM cannot override a block.

---

## 6. Compliance and regional policy

This is legal-risk territory; get counsel before enabling a region.

- **United States (CAN-SPAM):** accurate headers and subject, physical postal address,
  clear opt-out, honor opt-outs promptly, no deceptive claims. Cold B2B is generally
  permitted with these controls.
- **EU/UK (GDPR + ePrivacy):** B2B rules differ by country. Requires a legitimate-
  interest assessment, transparency, data minimisation, retention, and opt-out. Do not
  enable until reviewed; default to excluding the EU/UK if unsure.
- **Canada (CASL):** consent is generally required (express or implied). Exclude unless
  you have a documented basis.
- **Australia (Spam Act):** consent is required. Exclude unless documented.
- **India and other markets:** review DPDP and local marketing rules before enabling.
- **Data sources:** use publicly available business contact data and company inboxes;
  avoid purchased lists, personal social profiles without a lawful basis, and sensitive
  categories. Keep source and timestamp for every email.
- **AI disclosure:** do not impersonate a human or fabricate familiarity. The sender is
  a real business; AI assistance does not remove responsibility for claims.
- **Platform policies:** follow Cloudflare Email Service, Google/Microsoft and mailbox
  provider rules. No spoofing, no evasive "humanization", no fake "Re:" threads.
- **Record keeping:** store the mandate, draft, evidence, policy decision, recipient,
  timestamp and outcome.

"Humanized" means genuine, specific, low-volume, well-timed and easy to decline. It does
not mean evading spam filters or pretending a machine is a person.

---

## 7. Deliverability and human pacing

Keep the existing controls and add domain-level monitoring:

- dedicated sending subdomain, separate from transactional mail;
- SPF, DKIM, DMARC, custom tracking domain if tracking is ever used (prefer no tracking
  in first contact);
- warm-up: 10/day → 20/day → 30/day, one domain per day, 4–10 minute randomized gaps;
- business hours, weekdays, local timezone, holiday calendar;
- plain text, no links/attachments/images in first contact;
- verified or high-confidence business emails only;
- role inboxes allowed with routing copy, no-reply blocked;
- no more than one cold email per company domain per day; 30-day company cooldown;
- stop on reply, opt-out, bounce, complaint, or manual pause;
- monitor bounce (<2%), complaint (<0.1%), unsubscribe and reply rates;
- pause the mandate automatically when thresholds breach;
- seed-mailbox tests for every copy change;
- no volume ramp without human confirmation.

For follow-ups: max 2–3 steps, new angle each time, never "just checking in", and stop
immediately on reply.

---

## 8. Autopilot UX

### Setup ("Arm Autopilot")

A checklist, not a single blind toggle:

- choose offer and ICP;
- choose sending identity/domain;
- choose countries (default: US only);
- set daily/weekly caps and budget;
- set approval mode (review-first recommended);
- confirm the plain-English mandate;
- run a 10-recipient dry run and inspect the drafts;
- arm.

### Dashboard

- status: armed / paused / stopped / needs review;
- next run and next send window;
- pipeline counts: discovered → enriched → qualified → drafted → scheduled → sent;
- today's sends vs cap, warm-up day, domain health;
- replies, positive replies, meetings, opt-outs, bounces, complaints;
- draft review queue (for review-first mode);
- spend: search, AI, email;
- audit feed with the reason for every block and send;
- **Pause instantly** and **Stop and revoke mandate** controls.

### Autopilot button

The button opens the mandate summary and status. Turning it on requires a fresh
confirmation if the mandate has changed. Turning it off immediately cancels scheduled
sends and stops new work. Existing replies remain in the inbox.

### Escalation

The supervisor pauses and notifies when:

- complaint/bounce threshold exceeded;
- domain authentication fails;
- reply sentiment turns negative repeatedly;
- no eligible leads remain;
- AI or search budget reaches 80%;
- draft quality falls below threshold;
- a human takes over a conversation;
- more than N consecutive tool failures.

---

## 9. Data model

Add these tables/columns (D1 or Postgres; no schema change to existing email tables
except optional links):

- `autopilot_mandates` — versioned approval policy.
- `autopilot_runs` — one daily/period run, status, plan, budget, metrics.
- `autopilot_steps` — durable step state, attempts, errors, idempotency key.
- `autopilot_events` — audit: decision, reason, evidence, actor (agent/human).
- `autopilot_pauses` — reason, until, actor.
- `email_send_coins.autopilot_mandate_id` (nullable).
- `email_send_queue.source` = `manual | copilot | autopilot`.
- `email_send_queue.idempotency_key` unique.
- `email_send_coins` immutable content hash already exists.
- Keep `activity_log` for human-readable audit.

Every send gets: mandate_id, run_id, draft_id, policy decision, content hash,
recipient source, and timestamp.

---

## 10. 24/7 runtime

Current Vercel Hobby cron is once daily; that is not enough for a reliable autopilot.

Target runtime (aligned with the Cloudflare migration plan):

- **Cloudflare Workflows** for durable daily plans and long-running steps.
- **Queues** for discovery, enrichment, drafting, reply processing.
- **Durable Objects** for per-workspace autopilot lock, send scheduler and idempotency.
- **Cron/DO alarms** every minute during send windows.
- **D1** for state; **R2** for raw email/attachments; **Workers AI + AI Gateway** for
  drafting/classification with cost caps.

Interim on Vercel/Supabase:

- keep the existing jobs queue;
- add an external 5-minute scheduler (or Workers scheduled handler) calling the worker;
- use row-level locks/status transitions for idempotency;
- do not rely on a browser tab to run the pipeline.

The supervisor must be restart-safe: every step has a status, retry count, and a
resume path.

---

## 11. Metrics and learning

Leading:

- discovered per day; enrichment success; email found rate; qualified rate;
- drafts per qualified lead; quality score; review rejection rate;
- sends, delivery, bounce, complaint, opt-out;
- positive reply rate, meeting rate, cost per qualified lead, cost per meeting.

Guardrail:

- bounce <2%, complaint <0.1%, opt-out <0.5%, domain reputation, spam-folder seeds;
- policy block reasons; manual override rate; time-to-first-response.

Learning loop:

- A/B test one variable at a time: offer angle, opening, subject, CTA, persona;
- segment by signal, industry, role and region;
- do not let the agent rewrite the mandate or target regions;
- prioritize positive replies and meetings, not open rates (tracking is unreliable and
  can hurt deliverability).

---

## 12. Roadmap

### Phase 0 — Policy and data foundation (1 week)

- legal review for target regions;
- define mandate, audit, idempotency;
- finalize sending domain and compliance footer;
- define exclusion lists and data-source policy.

### Phase 1 — Autopilot Assist (2 weeks)

- supervisor state machine + dashboard + pause;
- daily discovery/enrichment/qualification/drafting;
- review-first sending; no auto-send;
- metrics and audit.

Exit: 10 business days of clean drafts, no deliverability incidents.

### Phase 2 — Bounded Autopilot (2–3 weeks)

- auto-mint send coins inside mandate after first 20 manual approvals;
- hard policy gate; automatic pause thresholds;
- follow-up sequences with stop rules;
- run 24/7 scheduling via Workflows/Queues/DO.

Exit: 30 days: complaint <0.1%, bounce <2%, no policy violations, positive reply
baseline established.

### Phase 3 — Reply and learning agent (2 weeks)

- classify replies, stop sequences, draft responses for human approval;
- update targeting from outcomes;
- daily digest and weekly strategy report.

### Phase 4 — Adaptive scale (ongoing)

- increase caps only with human confirmation;
- add lookalike segments;
- evaluate new sources;
- keep regional allowlist and offer approval human-controlled.

---

## 13. Cost model

- Workers Paid: $5/month minimum.
- Email: 3,000/month included; $0.35/1k after. At 10 sends/day (~220/month) email is
  included; at 30/day (~660/month) still included.
- Search/Crunchbase/Apollo: usage-based; set a hard monthly cap.
- AI: 10k Workers AI Neurons/day free; budget $5–30/month for enrichment and drafting;
  more if using Claude/frontier models.
- Infrastructure: one Worker + D1 + R2 + Queues at low volume fits inside the $5 plan.
- Human review time is the largest hidden cost; review-first mode is an investment, not
  overhead.

---

## 14. Non-negotiable rules

1. No send without an armed mandate and a policy-engine approval.
2. No purchased lists; no guessed or scraped personal emails without a lawful basis.
3. No region outside the approved allowlist.
4. No email to a suppressed, replied, complained or bounced address.
5. No second cold email to the same company inside the cooldown.
6. No links, attachments or HTML on first contact; no fake familiarity; no deceptive
   subject lines.
7. No volume increase without human confirmation.
8. No LLM override of the send gate.
9. Pause on risk; never "fix" deliverability by increasing volume.
10. Every decision and send is auditable.

---

## 15. Decisions needed before building

1. **Regions:** US only first, or US + reviewed EU/UK? Canada/Australia excluded.
2. **Sending identity:** shared workspace subdomain vs per-workspace domain.
3. **Approval mode:** review-first for how many sends before auto?
4. **Starting volume:** 10/day for 7 days, then 20, then 30.
5. **Offer and ICP:** one approved offer per mandate.
6. **Replies:** auto-draft only, or auto-send simple acknowledgements?
7. **Budget:** monthly caps for search, AI and email.
8. **Human owner:** who gets pause/escalation notifications?

Until these are answered, the correct build is **Autopilot Assist**, not fully
autonomous sending.
