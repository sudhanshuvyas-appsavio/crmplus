# Monthly Visit escalation: offset verification

Read-only evidence gathered 2026-11-19:
1. The workflow configurations through the API (`list_automations`): the "date arrives" block stores `{hour, minute, timezone}` and, when an offset exists, `offset: {count, unit}`.
2. The monday Automations panel of the Monthly Visit board (Manage / 11), card view, run history tab. Nothing was opened for editing.

## What is verified

| Automation (id) | Trigger column | Offset stored | Time (IST) | Conditions | Action | Wording | Verified |
|---|---|---|---|---|---|---|---|
| A-4 1939784316 | Visited Date | **none (0)** | 18:00 | Pending Payment = Yes; Visited/Not Visited is Visited or Not Visited | notify Person + Accounts; create Payment Collection "Monthly Visit - {name}" | "...after 30 days" | config read |
| A-5 1939784318 | Visited Date | **none (0)** | 22:15 | same | same | "...after 45 days" | config read |
| A-6 1939784296 | Visited Date | **none (0)** | 22:45 | same | same | "...after 60 days" | config read |
| A-7 1939789663 | Created Date | **none (0)** | 18:15 | Visited Date empty; Pending = Yes; status Visited or Not Visited | same | "you have not visited ... after 30 days" | config read |
| A-8 1939789665 | Created Date | **none (0)** | 22:15 | same | same | "...after 45 days" | config read |
| A-9 1939789669 | Created Date | **none (0)** | 22:45 | same | same | text says "you have visited ... after 60 days" | config read |
| A-3 1939786802 (for comparison) | Visited Date | **+30 days** | 10:00 | status Visited | notify Person + Accounts | "...not collect the payment." | config read |

Supporting observations:
- A-3 is the only one whose stored configuration contains an offset, so the API **does** return offsets when they exist; its absence on the six is therefore a recorded fact, not a gap in what could be read.
- The panel's summary sentences do **not** print offsets (A-3 reads "When Visited Date arrives and only if ... Visited, notify someone"), so the panel cannot confirm or deny them; only the stored configuration can.
- One of the six has the description "30 Days Payment Creation"; the run history of the board says **"No automations runs yet"** (no run has ever been recorded), so behaviour has not been observed either.
- The three Visited-Date automations carry different times of day (18:00, 22:15, 22:45) and the three Created-Date ones too (18:15, 22:15, 22:45): consistent with test settings.

## Conclusion

monday's stored configuration says the six automations fire **on the date itself**, at three different times of the evening, not 30/45/60 days later. The wording ("after 30 days") and the description ("30 Days Payment Creation") show the **intent** was 30/45/60 days. These two disagree and monday has never run them.

## Comparison with the migration

`supabase/migrations/20261120100000_task_rules_monday_timing.sql` sets the escalation `days` to `[30, 45, 60]` and applies them as offsets, with monday's times of day. That follows the **intent**, not the stored configuration. Replicating the stored configuration literally would make all three "steps" fire on the same day and create three Payment Collection items for one visit.

I did not change the migration: the instruction was not to change offsets on assumption, and either choice is a business decision.

| Option | Effect |
|---|---|
| A. Keep 30/45/60-day offsets (current) | matches the wording and the description; differs from the stored configuration |
| B. Offsets 0 as stored | matches the stored configuration; three Payment Collection items on day 0 for one visit |

**Decision needed from the business.** To switch to B the escalation `days` must become `[0]` for each step through a small migration (the message text uses the step number, so the three steps would need their own labels); the times of day already match monday.
