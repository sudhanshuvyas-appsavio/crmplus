-- Cheque Collection (monday A-17): the "Your Check for {name} is Collected" notification must also fire when
-- the cheque becomes Collected because a photo was attached.
--
-- The trigger was `after insert or update of status`. A cheque photo arrives as an UPDATE of photo_path only;
-- the status change to Collected is made by the BEFORE trigger (task_cheque_guard), and PostgreSQL does not
-- count changes made by a BEFORE trigger when deciding whether an `UPDATE OF status` trigger fires. So a photo
-- added through the proof upload never notified Accounts. The function already ignores rows that were
-- Collected before, so the trigger can safely run on every update.
--
-- Safe to run twice.

drop trigger if exists trg_cheque_collected_notify on public.task_cheques;
create trigger trg_cheque_collected_notify after insert or update on public.task_cheques
  for each row execute function public.cheque_collected_notify();
