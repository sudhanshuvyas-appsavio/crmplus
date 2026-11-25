// Standalone test of 20261125170000_commission_invoice_register.sql in an in-memory PostgreSQL (PGlite).
// Stand-in base tables mirror the live schema (columns the migration touches). Run: node commission-invoice.mjs
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'

const db = new PGlite()
const mig = fs.readFileSync(new URL('../../migrations/20261125170000_commission_invoice_register.sql', import.meta.url), 'utf8')
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS', name) } else { fail++; console.log('FAIL', name, extra) } }
const q = async (sql) => (await db.query(sql)).rows
const as = async (uid) => db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false)`)
const fails = async (sql) => { try { await db.exec(sql); return null } catch (e) { return String(e.message).split('\n')[0] } }

await db.exec(`
create schema if not exists auth; create schema if not exists storage;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
end $$;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table public.profiles (id uuid primary key default gen_random_uuid(), name text, is_admin boolean default false, is_active boolean default true);
create table public.user_permissions (user_id uuid, permission text);
create function public.has_permission(p text) returns boolean language sql stable security definer as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false) or exists (select 1 from user_permissions where user_id = auth.uid() and permission = p) $$;
create function public.has_any_permission(p text[]) returns boolean language sql stable security definer as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false) or exists (select 1 from user_permissions where user_id = auth.uid() and permission = any(p)) $$;

create table public.companies (id uuid primary key default gen_random_uuid(), name text, is_active boolean default true);
create table public.buyer_master (id uuid primary key default gen_random_uuid(), name text, messenger_id uuid);
create table public.supplier_master (id uuid primary key default gen_random_uuid(), name text, messenger_id uuid);
create table public.count_master (id uuid primary key default gen_random_uuid(), name text, display_name text);
create table public.orders (id uuid primary key default gen_random_uuid(), order_no text, order_date date default current_date, status text default 'open_for_execution',
  buyer_id uuid, supplier_id uuid, company_id uuid, count_id uuid, quantity numeric, uom text, bag_weight numeric, buyer_rate numeric default 0, supplier_rate numeric default 0,
  buyer_comm_basis text, buyer_comm_value numeric, supplier_comm_basis text, supplier_comm_value numeric, commission_type text, commission_value numeric, tentative_dispatch_date date, invoice_date date);
create table public.order_dispatches (id uuid primary key default gen_random_uuid(), order_id uuid references public.orders(id), dispatch_date date default current_date, quantity numeric,
  invoice_no text, mill_invoice_no text, mill_invoice_date date, invoice_date date, entry_value numeric, total_weight numeric, buyer_commission numeric, supplier_commission numeric,
  transporter_invoice_no text, transport_id uuid, vehicle_no text);
create table public.order_transports (id uuid primary key default gen_random_uuid(), kind text, freight_amount numeric);
create table public.order_payments (id uuid primary key default gen_random_uuid(), order_id uuid, kind text, amount numeric);
create sequence public.cinv_seq;
create table public.task_payments (id uuid primary key default gen_random_uuid(), task_id uuid not null, amount numeric not null check (amount > 0), paid_on date not null default current_date,
  mode text, reference text, notes text, order_payment_id uuid, created_by uuid default auth.uid(), created_at timestamptz not null default now());
create function public.task_payment_after() returns trigger language plpgsql as $$ begin
  update public.tasks set amount_collected = amount_collected + new.amount where id = new.task_id;
  update public.tasks set status = 'done' where id = new.task_id and amount > 0 and amount_collected >= amount and status not in ('done', 'cancelled');
  return null; end $$;
create trigger trg_task_payment_after after insert on public.task_payments for each row execute function public.task_payment_after();
create function public.task_log(p_task uuid, p_kind text, p_from text, p_to text, p_note text, p_data jsonb default null, p_dedupe text default null) returns void language sql as $$ select 1 $$;
-- the helper functions of the Dispatch and Billing migrations 20261125100000 / 20261125110000 (stand-ins: nothing cancelled or returned)
create function public.order_net_dispatched(p uuid) returns numeric language sql stable as $$ select coalesce(sum(quantity), 0) from public.order_dispatches where order_id = p $$;
create function public.order_cancelled(p uuid) returns numeric language sql stable as $$ select 0::numeric $$;
create function public.order_returned_qty(p uuid) returns numeric language sql stable as $$ select 0::numeric $$;
create function public.order_balance(p uuid) returns numeric language sql stable as $$ select greatest(o.quantity - public.order_net_dispatched(o.id), 0) from public.orders o where o.id = p $$;
create table public.task_types (key text primary key, default_due_days int);
insert into public.task_types values ('commission_invoice_delivery', 2);
create table public.tasks (id uuid primary key default gen_random_uuid(), task_type text, title text, due_date date, assigned_to uuid, buyer_id uuid, supplier_id uuid, order_id uuid,
  commission_invoice_id uuid, amount numeric, amount_collected numeric default 0, details jsonb, dedupe_key text unique, status text default 'todo',
  task_no text, accounts_staff_id uuid, start_date date, lat numeric, lng numeric, source_task_id uuid, created_at timestamptz default now());
create table public.task_attachments (id uuid primary key default gen_random_uuid(), task_id uuid);
create function public.default_task_assignee(p uuid) returns uuid language sql stable as $$ select messenger_id from buyer_master where id = p $$;
create function public.trade_commission(p_basis text, p_value numeric, p_amount numeric, p_uom text, p_qty numeric, p_total_weight numeric, p_unit_weight numeric)
returns numeric language sql immutable as $$ select case p_basis when 'pct' then p_amount * p_value / 100 when 'per_kg' then p_value * p_total_weight when 'per_bag' then case when p_uom in ('KG', 'TONS') then case when p_unit_weight > 0 then p_value * p_total_weight / p_unit_weight end else p_value * p_qty end end $$;

-- the old invoice table and its three triggers (as in production)
create table public.commission_invoices (id uuid primary key default gen_random_uuid(), invoice_no text unique, order_id uuid not null unique references public.orders(id),
  invoice_date date not null default current_date, buyer_id uuid not null, supplier_id uuid not null, company_id uuid not null, amount numeric not null check (amount >= 0),
  created_by uuid default auth.uid(), created_at timestamptz not null default now());
create function public.commission_invoice_guard() returns trigger language plpgsql as $$ begin new.invoice_no := 'CINV-X-' || nextval('cinv_seq'); return new; end $$;
create trigger trg_ci_no before insert on public.commission_invoices for each row execute function public.commission_invoice_guard();
create table public.close_log (order_id uuid, at timestamptz default now());
create function public.order_close_check() returns trigger language plpgsql as $$ begin insert into close_log(order_id) values (case when tg_op='DELETE' then old.order_id else new.order_id end); return null; end $$;
create trigger trg_ci_close after insert on public.commission_invoices for each row execute function public.order_close_check();
create function public.commission_invoice_tasks() returns trigger language plpgsql as $$ begin return null; end $$;
create trigger trg_commission_invoice_tasks after insert on public.commission_invoices for each row execute function public.commission_invoice_tasks();

create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (name text, bucket_id text);
alter table storage.objects enable row level security;
`)

// fixtures
const id = async (sql) => (await q(sql))[0].id
const admin = await id(`insert into profiles(name,is_admin) values ('Admin', true) returning id`)
const clerk = await id(`insert into profiles(name,is_admin) values ('Clerk', false) returning id`)
const mBuyer = await id(`insert into profiles(name) values ('Buyer Messenger') returning id`)
const mSupp = await id(`insert into profiles(name) values ('Supplier Messenger') returning id`)
const C1 = await id(`insert into companies(name) values ('Unit One') returning id`)
const C2 = await id(`insert into companies(name) values ('Unit Two') returning id`)
const B1 = await id(`insert into buyer_master(name, messenger_id) values ('Buyer One', '${mBuyer}') returning id`)
const S1 = await id(`insert into supplier_master(name, messenger_id) values ('Mill One', '${mSupp}') returning id`)
const CNT = await id(`insert into count_master(name, display_name) values ('30s Cotton', '30s cotton') returning id`)
const O1 = await id(`insert into orders(order_no, buyer_id, supplier_id, company_id, count_id, quantity, uom, bag_weight, buyer_comm_basis, buyer_comm_value, supplier_comm_basis, supplier_comm_value)
  values ('ORD-1', '${B1}', '${S1}', '${C1}', '${CNT}', 30, 'BAG', 50, 'pct', 1, 'per_bag', 2) returning id`)
const D1 = await id(`insert into order_dispatches(order_id, quantity, invoice_date, invoice_no, entry_value, total_weight, buyer_commission, supplier_commission) values ('${O1}', 10, '2026-11-05', 'MI-1', 100000, 500, 1000, 20) returning id`)
const D2 = await id(`insert into order_dispatches(order_id, quantity, invoice_date, invoice_no, entry_value, total_weight, buyer_commission, supplier_commission) values ('${O1}', 20, '2026-11-10', 'MI-2', 200000, 1000, 2000, 40) returning id`)
// an order the old way: one legacy invoice, must never be offered again
const O2 = await id(`insert into orders(order_no, buyer_id, supplier_id, company_id, count_id, quantity, uom, buyer_comm_basis, buyer_comm_value) values ('ORD-2', '${B1}', '${S1}', '${C1}', '${CNT}', 5, 'BAG', 'pct', 1) returning id`)
const D3 = await id(`insert into order_dispatches(order_id, quantity, invoice_date, entry_value, total_weight, buyer_commission, supplier_commission) values ('${O2}', 5, '2026-11-06', 50000, 250, 500, 0) returning id`)
await db.exec(`insert into commission_invoices(order_id, buyer_id, supplier_id, company_id, amount) values ('${O2}', '${B1}', '${S1}', '${C1}', 500)`)

// ---- run the migration (twice: it must be re-runnable)
let err = await fails(mig); ok('migration runs', err === null, err)
err = await fails(mig); ok('migration runs a second time', err === null, err)
ok('legacy invoice is marked legacy', (await q(`select is_legacy from commission_invoices where order_id='${O2}'`))[0].is_legacy === true)
ok('legacy number kept', (await q(`select invoice_no from commission_invoices where order_id='${O2}'`))[0].invoice_no.startsWith('CINV-'))

const payload = (extra = {}) => JSON.stringify({ company_id: C1, party_type: 'buyer', party_id: B1, period_from: '2026-11-01', period_to: '2026-11-30', dispatch_ids: [D1, D2], ...extra }).replace(/'/g, "''")
const create = (extra) => `select public.create_commission_invoice('${payload(extra)}'::jsonb) as id`
const nCand = async (type, party, from = '2026-11-01', to = '2026-11-30', basis = 'null', val = 'null') =>
  (await q(`select count(*)::int n from commission_candidate_lines('${C1}', '${type}', '${party}', '${from}', '${to}', ${basis}, ${val})`))[0].n

await as(admin)
ok('buyer candidates: 2 lines (legacy order excluded)', (await nCand('buyer', B1)) === 2)
ok('candidates respect the dates', (await nCand('buyer', B1, '2026-11-08', '2026-11-30')) === 1)
ok('candidates respect the Business Unit', (await q(`select count(*)::int n from commission_candidate_lines('${C2}', 'buyer', '${B1}', '2026-11-01', '2026-11-30')`))[0].n === 0)

// the dispatch entry is monday's subitem: its Invoice No. / Invoice Date, the parent's date when the entry has none, then the mill invoice
const O3 = await id(`insert into orders(order_no, buyer_id, supplier_id, company_id, count_id, quantity, uom, invoice_date, buyer_comm_basis, buyer_comm_value) values ('ORD-3', '${B1}', '${S1}', '${C2}', '${CNT}', 20, 'BAGS', '2026-11-18', 'pct', 0) returning id`)
await db.exec(`insert into order_dispatches(order_id, quantity, dispatch_date, invoice_date, invoice_no, mill_invoice_no, entry_value, total_weight, buyer_commission) values
  ('${O3}', 5, '2026-11-03', '2026-11-04', 'DI-5', 'MILL-X', 1000, 50, 0),
  ('${O3}', 5, '2026-11-03', null, null, 'MILL-9', 1000, 50, 0),
  ('${O3}', 5, '2026-11-03', null, null, null, 1000, 50, 0)`)
const c3 = await q(`select invoice_no, invoice_date::text d from commission_candidate_lines('${C2}', 'buyer', '${B1}', '2026-11-01', '2026-11-30') order by invoice_date, invoice_no nulls last`)
ok('entry Invoice No. and Invoice Date come first (DI-5, 4 Nov), not the mill invoice', c3[0]?.invoice_no === 'DI-5' && c3[0]?.d === '2026-11-04', JSON.stringify(c3))
ok('without an Invoice No. the mill invoice no. is used, with the parent invoice date (18 Nov)', c3.some((x) => x.invoice_no === 'MILL-9' && x.d === '2026-11-18'), JSON.stringify(c3))
ok('an entry with no number keeps a blank number and the parent date', c3.some((x) => x.invoice_no === null && x.d === '2026-11-18'), JSON.stringify(c3))

const bp = await q(`select party_id, party_name, lines::int n from commission_billable_parties('${C1}', 'buyer')`)
ok('billable buyers of the Business Unit: Buyer One with its 2 lines', bp.length === 1 && bp[0].party_id === B1 && bp[0].party_name === 'Buyer One' && bp[0].n === 2, JSON.stringify(bp))
const bp2 = await q(`select party_id, lines::int n from commission_billable_parties('${C2}', 'buyer')`)
ok('each Business Unit lists only its own lines (Unit Two: Buyer One with its 3 entries)', bp2.length === 1 && bp2[0].party_id === B1 && bp2[0].n === 3, JSON.stringify(bp2))
ok('a party with no commission terms on the supplier side is not offered', (await q(`select count(*)::int n from commission_billable_parties('${C2}', 'supplier')`))[0].n === 0)
// permission
await as(clerk)
err = await fails(create())
ok('a user without order.manage cannot create', err && err.includes('permission'), err)
await as(admin)

// create the buyer invoice: commission 1000 + 2000 = 3000, add 10, deduct 5, net 3005
let inv1 = (await q(create({ add_amount: 10, deduct_amount: 5, round_off: 0.3, tds_amount: 30, party_note: 'Dear Sir', remarks: 'Nov', document_no: 'DOC-7' })))[0].id
let r = (await q(`select * from commission_invoices where id='${inv1}'`))[0]
ok('invoice number is the plain series, starting at 1', r.invoice_no === '1', r.invoice_no)
ok('commission total 3000', Number(r.commission_total) === 3000)
ok('Document No is stored', r.document_no === 'DOC-7', r.document_no)
ok('net = total + add - deduct = 3005', Number(r.net_amount) === 3005 && Number(r.amount) === 3005)
ok('total quantity 30', Number(r.total_bags) === 30)
ok('round off and TDS stored, not applied', Number(r.round_off) === 0.3 && Number(r.tds_amount) === 30 && Number(r.net_amount) === 3005)
ok('party buyer, supplier id empty', r.party_type === 'buyer' && r.buyer_id === B1 && r.supplier_id === null)
let lines = await q(`select * from commission_invoice_lines where invoice_id='${inv1}' order by sr_no`)
ok('two lines, ordered by date, with count, the entry invoice no. and the mill as counterparty', lines.length === 2 && lines[0].sr_no === 1 && lines[0].invoice_no === 'MI-1' && lines[0].count_label === '30s Cotton' && lines[0].counterparty === 'Mill One')
ok('line amounts 1000 and 2000', Number(lines[0].amount) === 1000 && Number(lines[1].amount) === 2000)

// the delivery task, for the buyer, assigned to the buyer's messenger
let t = await q(`select * from tasks where commission_invoice_id='${inv1}'`)
ok('one delivery task, amount = net, assigned to the buyer messenger', t.length === 1 && Number(t[0].amount) === 3005 && t[0].assigned_to === mBuyer, JSON.stringify(t))

// double billing
err = await fails(create())
ok('the same lines cannot be billed again to the same party', err !== null && /invoiced|billed/i.test(err), err)
ok('buyer candidates now empty', (await nCand('buyer', B1)) === 0)
ok('no billable buyer is left in the Business Unit', (await q(`select count(*)::int n from commission_billable_parties('${C1}', 'buyer')`))[0].n === 0)
err = await fails(`delete from order_dispatches where id = '${D1}'`)
ok('a billed dispatch entry cannot be removed', err && err.includes('billed on commission invoice'), err)
err = await fails(`update order_dispatches set quantity = 99 where id = '${D1}'`)
ok('the quantity of a billed entry cannot be changed', err && err.includes('billed on commission invoice'), err)
err = await fails(`update order_dispatches set invoice_no = 'X-1' where id = '${D1}'`)
ok('the invoice no. of a billed entry cannot be changed', err && err.includes('billed on commission invoice'), err)
err = await fails(`update order_dispatches set quantity = quantity, vehicle_no = 'TN-01' where id = '${D1}'`)
ok('an unrelated edit (vehicle) and a no-op update stay possible', err === null, err)
ok('the supplier side of the same lines is still open', (await nCand('supplier', S1)) === 2)

// supplier invoice, with a manual rate: per bag 3 -> 30 bags = 90
const supp = { party_type: 'supplier', party_id: S1, commission_basis: 'per_bag', commission_value: 3 }
let inv2 = (await q(create(supp)))[0].id
r = (await q(`select * from commission_invoices where id='${inv2}'`))[0]
ok('supplier invoice number 2, override applied (30 bags x 3 = 90)', r.invoice_no === '2' && Number(r.commission_total) === 90 && r.supplier_id === S1 && r.buyer_id === null, JSON.stringify(r))
t = await q(`select * from tasks where commission_invoice_id='${inv2}'`)
ok('supplier invoice task goes to the supplier messenger', t.length === 1 && t[0].assigned_to === mSupp)

// validation
err = await fails(create({ dispatch_ids: [] })); ok('needs at least one line', err && err.includes('at least one'), err)
err = await fails(create({ period_from: '2026-12-01', period_to: '2026-11-01' })); ok('dates in order', err && err.includes('cannot be after'), err)
err = await fails(create({ commission_basis: 'pct' })); ok('basis without value refused', err && err.includes('both'), err)
err = await fails(create({ deduct_amount: 99999 })); ok('negative net refused', err !== null)
err = await fails(create({ dispatch_ids: [D3], party_id: B1 })); ok('a line of a legacy-billed order cannot be picked', err !== null)

// order close picture: buyer and supplier both billed -> done
ok('order commission billed once both parties are invoiced', (await q(`select order_commission_billed('${O1}') b`))[0].b === true)
ok('order_close_status reports invoice_done', (await q(`select order_close_status('${O1}')->>'invoice_done' d`))[0].d === 'true')
ok('the legacy order counts as billed', (await q(`select order_commission_billed('${O2}') b`))[0].b === true)
ok('closing check ran for the order on billing', (await q(`select count(*)::int n from close_log where order_id='${O1}'`))[0].n >= 2)

// pending list
await db.exec(`insert into order_dispatches(order_id, quantity, invoice_date, entry_value, total_weight, buyer_commission, supplier_commission) values ('${O1}', 5, '2026-11-20', 50000, 250, 500, 10)`)
let pend = await q(`select * from pending_commission_bills()`)
ok('pending list shows the new un-billed entry only', pend.length === 1 && Number(pend[0].commission_amount) === 510 && Number(pend[0].quantity) === 5, JSON.stringify(pend))
ok('dashboard counts it', (await q(`select billing_dispatch_dashboard()->'commission_pending'->>'pending' n`))[0].n === '1')

// cancel
err = await fails(`select cancel_commission_invoice('${inv1}', '')`); ok('cancel needs a reason', err && err.includes('reason'), err)
await as(clerk)
err = await fails(`select cancel_commission_invoice('${inv1}', 'x')`); ok('cancel needs order.manage', err && err.includes('permission'), err)
await as(admin)
err = await fails(`update tasks set amount_collected = 100 where commission_invoice_id='${inv2}'; select cancel_commission_invoice('${inv2}', 'paid')`)
ok('an invoice with payment recorded cannot be cancelled', err && err.includes('Payment'), err)
await db.exec(`update tasks set amount_collected = 0 where commission_invoice_id='${inv2}'`)
err = await fails(`select cancel_commission_invoice('${inv1}', 'wrong party')`); ok('cancel works', err === null, err)
ok('cancelled invoice is marked and its lines freed', (await q(`select status, cancel_reason from commission_invoices where id='${inv1}'`))[0].status === 'cancelled'
  && (await q(`select count(*)::int n from commission_invoice_lines where invoice_id='${inv1}' and active`))[0].n === 0)
ok('its delivery task is cancelled', (await q(`select status from tasks where commission_invoice_id='${inv1}'`))[0].status === 'cancelled')
ok('the lines can be billed again (the 2 cancelled + the later entry)', (await nCand('buyer', B1)) === 3)
ok('the order is no longer fully billed', (await q(`select order_commission_billed('${O1}') b`))[0].b === false)
err = await fails(`select cancel_commission_invoice('${inv1}', 'again')`); ok('cannot cancel twice', err && err.includes('already'), err)
const inv3 = (await q(create()))[0].id
ok('a cancelled number is never reused (next is 3)', (await q(`select invoice_no from commission_invoices where id='${inv3}'`))[0].invoice_no === '3')
err = await fails(`select generate_commission_invoice('${O1}')`); ok('the old per-order path is closed', err && err.includes('Commission Invoices page'), err)

// ---- payment tracking and status (monday: Mode of Payment, Payment Collected, Payment Pending, Status Generated/Sent/Pending)
const rec = (inv, amt, mode = 'neft', date = 'null', ref = 'null') => `select record_commission_payment('${inv}', ${amt}, ${mode === null ? 'null' : `'${mode}'`}, ${date}, ${ref})`
const inv3row = async () => (await q(`select status, paid_amount, payment_pending, payment_mode, sent_at from commission_invoices where id='${inv3}'`))[0]
let r3 = await inv3row()
ok('a new invoice has nothing collected and the whole net pending', Number(r3.paid_amount) === 0 && Number(r3.payment_pending) === 3000 && r3.payment_mode === null, JSON.stringify(r3))
await as(clerk)
err = await fails(rec(inv3, 100)); ok('recording a payment needs order.manage', err && err.includes('permission'), err)
await as(admin)
err = await fails(rec(inv3, 0)); ok('a zero payment is refused', err && err.includes('above 0'), err)
err = await fails(rec(inv3, -5)); ok('a negative payment is refused', err && err.includes('above 0'), err)
err = await fails(rec(inv3, 100.555)); ok('more than 2 decimals is refused', err && err.includes('2 decimals'), err)
err = await fails(rec(inv3, 100, 'bitcoin')); ok('a mode outside the list is refused', err && err.includes('mode of payment'), err)
err = await fails(rec(inv3, 100, null)); ok('the mode is required', err && err.includes('mode of payment'), err)
err = await fails(rec(inv3, 100, 'neft', `'2999-01-01'`)); ok('a future payment date is refused', err && err.includes('future'), err)
err = await fails(rec(inv3, 3000.01)); ok('a payment above the pending amount is refused', err && err.includes('more than'), err)
err = await fails(rec(inv1, 100)); ok('a cancelled invoice takes no payment', err && err.includes('cancelled'), err)
await db.exec(rec(inv3, 1000, 'neft', 'null', `'UTR123'`))
r3 = await inv3row()
ok('part payment: collected 1000, pending 2000, mode NEFT', Number(r3.paid_amount) === 1000 && Number(r3.payment_pending) === 2000 && r3.payment_mode === 'neft', JSON.stringify(r3))
ok('the receipt is kept with its reference', (await q(`select reference from commission_invoice_payments where invoice_id='${inv3}'`))[0].reference === 'UTR123')
await db.exec(rec(inv3, 2000, 'upi', `'2026-11-20'`))
r3 = await inv3row()
ok('fully paid: collected 3000, pending 0, mode is the last one (UPI)', Number(r3.paid_amount) === 3000 && Number(r3.payment_pending) === 0 && r3.payment_mode === 'upi', JSON.stringify(r3))
err = await fails(rec(inv3, 1)); ok('nothing more can be recorded once fully paid', err && err.includes('more than'), err)
err = await fails(`select cancel_commission_invoice('${inv3}', 'oops')`); ok('an invoice with a payment cannot be cancelled', err && err.includes('Payment has already'), err)
const upiPay = (await q(`select id from commission_invoice_payments where invoice_id='${inv3}' and mode='upi'`))[0].id
await as(clerk)
err = await fails(`select delete_commission_payment('${upiPay}')`); ok('deleting a payment needs order.manage', err && err.includes('permission'), err)
await as(admin)
await db.exec(`select delete_commission_payment('${upiPay}')`)
r3 = await inv3row()
ok('deleting a payment puts the amount back and the mode follows the remaining one', Number(r3.paid_amount) === 1000 && Number(r3.payment_pending) === 2000 && r3.payment_mode === 'neft', JSON.stringify(r3))

// status
ok('a new invoice is Generated', r3.status === 'generated' && r3.sent_at === null)
await db.exec(`select set_commission_invoice_status('${inv3}', 'sent')`)
r3 = await inv3row()
ok('Sent stamps the time', r3.status === 'sent' && r3.sent_at !== null)
await db.exec(`select set_commission_invoice_status('${inv3}', 'pending')`)
r3 = await inv3row()
ok('Pending clears the sent time', r3.status === 'pending' && r3.sent_at === null)
err = await fails(`select set_commission_invoice_status('${inv3}', 'cancelled')`); ok('cancelling is not a status change', err && err.includes('Status must be'), err)
err = await fails(`select set_commission_invoice_status('${inv1}', 'sent')`); ok('a cancelled invoice cannot change status', err && err.includes('cancelled'), err)
await as(clerk)
err = await fails(`select set_commission_invoice_status('${inv3}', 'sent')`); ok('status change needs order.manage', err && err.includes('permission'), err)
await as(admin)
await db.exec(`select set_commission_invoice_status('${inv3}', 'sent'); select set_commission_invoice_pdf('${inv3}', '${inv3}/invoice_x.pdf')`)
ok('the PDF path can still be set on a Sent invoice', (await q(`select pdf_path from commission_invoices where id='${inv3}'`))[0].pdf_path.endsWith('invoice_x.pdf'))
await db.exec(`select cancel_commission_invoice('${inv2}', 'supplier side not needed')`)
ok('Sent invoices still show in candidates as billed (lines stay taken)', (await nCand('buyer', B1)) === 1)

// an old one-per-order invoice can be paid too: pending = its amount
const legacy = (await q(`select id from commission_invoices where order_id='${O2}'`))[0].id
await db.exec(rec(legacy, 200, 'cash'))
const lg = (await q(`select paid_amount, payment_pending from commission_invoices where id='${legacy}'`))[0]
ok('old invoice: amount 500, paid 200, pending 300', Number(lg.paid_amount) === 200 && Number(lg.payment_pending) === 300, JSON.stringify(lg))

// removing an entry after its invoice is cancelled: the cancelled invoice keeps its snapshot line
const O4 = await id(`insert into orders(order_no, buyer_id, supplier_id, company_id, count_id, quantity, uom, buyer_comm_basis, buyer_comm_value) values ('ORD-4', '${B1}', '${S1}', '${C1}', '${CNT}', 5, 'BAGS', 'pct', 1) returning id`)
const D4 = await id(`insert into order_dispatches(order_id, quantity, invoice_date, invoice_no, entry_value, total_weight, buyer_commission, supplier_commission) values ('${O4}', 5, '2026-11-22', 'DI-22', 50000, 250, 500, 10) returning id`)
const inv4 = (await q(create({ dispatch_ids: [D4] })))[0].id
err = await fails(`delete from order_dispatches where id = '${D4}'`)
ok('the entry is protected while its invoice is live', err && err.includes('Cancel that invoice first'), err)
await db.exec(`select cancel_commission_invoice('${inv4}', 'wrong entry')`)
err = await fails(`delete from order_dispatches where id = '${D4}'`)
ok('after the invoice is cancelled the entry can be removed', err === null, err)
const kept = (await q(`select dispatch_id, invoice_no, active from commission_invoice_lines where invoice_id='${inv4}'`))[0]
ok('the cancelled invoice keeps its line as a snapshot (entry link cleared)', kept && kept.dispatch_id === null && kept.invoice_no === 'DI-22' && kept.active === false, JSON.stringify(kept))

// payment follow-through: the Payment Collection follow-up of the delivery task
const O5 = await id(`insert into orders(order_no, buyer_id, supplier_id, company_id, count_id, quantity, uom, buyer_comm_basis, buyer_comm_value) values ('ORD-5', '${B1}', '${S1}', '${C1}', '${CNT}', 5, 'BAGS', 'pct', 1) returning id`)
const D5 = await id(`insert into order_dispatches(order_id, quantity, invoice_date, invoice_no, entry_value, total_weight, buyer_commission) values ('${O5}', 5, '2026-11-23', 'DI-23', 100000, 250, 1000) returning id`)
const O6 = await id(`insert into orders(order_no, buyer_id, supplier_id, company_id, count_id, quantity, uom, buyer_comm_basis, buyer_comm_value) values ('ORD-6', '${B1}', '${S1}', '${C1}', '${CNT}', 5, 'BAGS', 'pct', 1) returning id`)
const D6 = await id(`insert into order_dispatches(order_id, quantity, invoice_date, invoice_no, entry_value, total_weight, buyer_commission) values ('${O6}', 5, '2026-11-24', 'DI-24', 50000, 250, 500) returning id`)
const inv5 = (await q(create({ dispatch_ids: [D5] })))[0].id
const inv6 = (await q(create({ dispatch_ids: [D6] })))[0].id
const followUp = async (invId) => {
  const dt = (await q(`select id from tasks where commission_invoice_id='${invId}' and task_type='commission_invoice_delivery'`))[0].id
  await db.exec(`update tasks set details = coalesce(details,'{}'::jsonb) || '{"pending_payment": true}'::jsonb where id='${dt}';
                 insert into tasks(task_type, title, source_task_id, status, details) values ('payment_collection', 'Commission Invoice follow-up', '${dt}', 'todo', '{}'::jsonb)`)
  return dt
}
const dt5 = await followUp(inv5)
const state = async (dt) => (await q(`select (select status from tasks where source_task_id='${dt}' and task_type='payment_collection') as fu, (select details->>'pending_payment' from tasks where id='${dt}') as flag`))[0]
await db.exec(rec(inv5, 400, 'neft'))
let st = await state(dt5)
ok('a part payment (400 of 1,000) leaves the follow-up open and the pending flag on', st.fu === 'todo' && st.flag === 'true', JSON.stringify(st))
await db.exec(rec(inv5, 600, 'upi'))
st = await state(dt5)
ok('full payment closes the follow-up and clears the pending flag', st.fu === 'done' && st.flag === 'false', JSON.stringify(st))
const dt6 = await followUp(inv6)
await db.exec(`select cancel_commission_invoice('${inv6}', 'raised in error')`)
st = await state(dt6)
ok('cancelling the invoice cancels its follow-up', st.fu === 'cancelled', JSON.stringify(st))

// the two-way link between an invoice and its Payment Collection follow-up
const mkInvoice = async (no, comm) => {
  const o = await id(`insert into orders(order_no, buyer_id, supplier_id, company_id, count_id, quantity, uom, buyer_comm_basis, buyer_comm_value) values ('ORD-${no}', '${B1}', '${S1}', '${C1}', '${CNT}', 5, 'BAGS', 'pct', 1) returning id`)
  const d = await id(`insert into order_dispatches(order_id, quantity, invoice_date, invoice_no, entry_value, total_weight, buyer_commission) values ('${o}', 5, '2026-11-2${no}', 'DI-L${no}', ${comm * 100}, 250, ${comm}) returning id`)
  return (await q(create({ dispatch_ids: [d] })))[0].id
}
const mkFollowUp = async (invId, amount) => {
  const dt = (await q(`select id from tasks where commission_invoice_id='${invId}' and task_type='commission_invoice_delivery'`))[0].id
  const f = await id(`insert into tasks(task_type, title, source_task_id, status, amount, amount_collected, details) values ('payment_collection', 'follow-up', '${dt}', 'todo', ${amount}, 0, '{}'::jsonb) returning id`)
  return f
}
const inv8 = await mkInvoice(1, 1000)
const fu8 = await mkFollowUp(inv8, 1000)
await db.exec(`insert into task_payments(task_id, amount, mode) values ('${fu8}', 300, 'cash')`)
let rc = await q(`select amount, mode, task_payment_id from commission_invoice_payments where invoice_id='${inv8}'`)
ok('a payment recorded by the collector on the follow-up becomes a receipt of the invoice', rc.length === 1 && Number(rc[0].amount) === 300 && rc[0].mode === 'cash' && rc[0].task_payment_id !== null, JSON.stringify(rc))
let iv = (await q(`select paid_amount, payment_pending, payment_mode from commission_invoices where id='${inv8}'`))[0]
ok('the invoice shows 300 collected, 700 pending, mode Cash', Number(iv.paid_amount) === 300 && Number(iv.payment_pending) === 700 && iv.payment_mode === 'cash', JSON.stringify(iv))
await db.exec(rec(inv8, 200, 'upi'))
const tp = await q(`select amount, mode, notes from task_payments where task_id='${fu8}' order by created_at`)
ok('a payment recorded on the invoice is copied to the follow-up (with a note saying where from)', tp.length === 2 && Number(tp[1].amount) === 200 && tp[1].mode === 'upi' && tp[1].notes.startsWith('Recorded on commission invoice'), JSON.stringify(tp))
ok('the follow-up shows 500 collected', Number((await q(`select amount_collected from tasks where id='${fu8}'`))[0].amount_collected) === 500)
ok('nothing is entered twice: the invoice has exactly 2 receipts', (await q(`select count(*)::int n from commission_invoice_payments where invoice_id='${inv8}'`))[0].n === 2)
await db.exec(`insert into task_payments(task_id, amount, mode) values ('${fu8}', 900, 'online')`)
rc = await q(`select amount, note from commission_invoice_payments where invoice_id='${inv8}' order by created_at desc limit 1`)
ok('a collector payment bigger than the pending amount records only what fits (500 of 900)', Number(rc[0].amount) === 500 && rc[0].note.includes('only 500'), JSON.stringify(rc))
iv = (await q(`select paid_amount, payment_pending, payment_mode from commission_invoices where id='${inv8}'`))[0]
ok('the invoice is fully paid (1000, nothing pending, mode Online)', Number(iv.paid_amount) === 1000 && Number(iv.payment_pending) === 0 && iv.payment_mode === 'online', JSON.stringify(iv))
ok('the follow-up is done', (await q(`select status from tasks where id='${fu8}'`))[0].status === 'done')
err = await fails(rec(inv8, 1)); ok('and nothing more can be recorded on the invoice', err && err.includes('more than'), err)

// a follow-up raised after part of the invoice was already paid starts with that amount
const inv9 = await mkInvoice(2, 1000)
await db.exec(rec(inv9, 250, 'neft'))
const fu9 = await mkFollowUp(inv9, 1000)
const f9 = (await q(`select amount_collected from tasks where id='${fu9}'`))[0]
ok('a follow-up raised later starts with the 250 already paid', Number(f9.amount_collected) === 250, JSON.stringify(f9))
ok('and that does not create a second receipt on the invoice', (await q(`select count(*)::int n from commission_invoice_payments where invoice_id='${inv9}'`))[0].n === 1)

// a cancelled invoice takes nothing from its follow-up
const inv10 = await mkInvoice(3, 1000)
const fu10 = await mkFollowUp(inv10, 1000)
await db.exec(`select cancel_commission_invoice('${inv10}', 'raised in error')`)
await db.exec(`insert into task_payments(task_id, amount, mode) values ('${fu10}', 100, 'cash')`)
ok('a payment on the follow-up of a cancelled invoice is not copied to it', (await q(`select count(*)::int n from commission_invoice_payments where invoice_id='${inv10}'`))[0].n === 0)

// the modes of the follow-up task are accepted on the invoice
await db.exec(rec(inv9, 10, 'cheque'))
ok('Cheque and Online are valid modes on the invoice', (await q(`select payment_mode from commission_invoices where id='${inv9}'`))[0].payment_mode === 'cheque')

// monday leaves People / Accounts empty on delivery items; here nobody is left out
const dtInv1 = (await q(`select assigned_to, accounts_staff_id from tasks where commission_invoice_id='${inv1}' and task_type='commission_invoice_delivery'`))[0]
ok('Accounts on the delivery task is the person who generated the invoice', dtInv1.accounts_staff_id === admin, JSON.stringify(dtInv1))
ok('Person is the buyer\'s Messenger when there is one', dtInv1.assigned_to === mBuyer, JSON.stringify(dtInv1))
const B3 = await id(`insert into buyer_master(name) values ('Buyer Without Messenger') returning id`)
const O9 = await id(`insert into orders(order_no, buyer_id, supplier_id, company_id, count_id, quantity, uom, buyer_comm_basis, buyer_comm_value) values ('ORD-9', '${B3}', '${S1}', '${C1}', '${CNT}', 5, 'BAGS', 'pct', 1) returning id`)
const D9 = await id(`insert into order_dispatches(order_id, quantity, invoice_date, invoice_no, entry_value, total_weight, buyer_commission) values ('${O9}', 5, '2026-11-26', 'DI-26', 100000, 250, 1000) returning id`)
const inv9b = (await q(`select public.create_commission_invoice('${JSON.stringify({ company_id: C1, party_type: 'buyer', party_id: B3, period_from: '2026-11-01', period_to: '2026-11-30', dispatch_ids: [D9] })}'::jsonb) as id`))[0].id
const dt9 = (await q(`select assigned_to, accounts_staff_id from tasks where commission_invoice_id='${inv9b}' and task_type='commission_invoice_delivery'`))[0]
ok('with no Messenger the Person falls back to whoever generated the invoice (never left empty)', dt9.assigned_to === admin && dt9.accounts_staff_id === admin, JSON.stringify(dt9))
// a zero-value invoice (monday has "Invoice 13" of 0) is refused
const O10 = await id(`insert into orders(order_no, buyer_id, supplier_id, company_id, count_id, quantity, uom, buyer_comm_basis, buyer_comm_value) values ('ORD-10', '${B1}', '${S1}', '${C1}', '${CNT}', 5, 'BAGS', 'pct', 0) returning id`)
const D10 = await id(`insert into order_dispatches(order_id, quantity, invoice_date, invoice_no, entry_value, total_weight, buyer_commission) values ('${O10}', 5, '2026-11-27', 'DI-27', 100000, 250, 0) returning id`)
err = await fails(create({ dispatch_ids: [D10] }))
ok('an invoice whose net amount is 0 is refused', err && err.includes('nothing to invoice'), err)

// edit the details of a live invoice
const edit = (invId, doc, note, rem) => `select update_commission_invoice_details('${invId}', ${doc === null ? 'null' : `'${doc}'`}, ${note === null ? 'null' : `'${note}'`}, ${rem === null ? 'null' : `'${rem}'`})`
await db.exec(edit(inv8, '  DOC-EDIT  ', 'Kind attention: Accounts', 'Edited remark'))
const ed = (await q(`select document_no, party_note, remarks, net_amount, status from commission_invoices where id='${inv8}'`))[0]
ok('Document No, Text and Remarks can be changed (trimmed), the amounts stay', ed.document_no === 'DOC-EDIT' && ed.party_note === 'Kind attention: Accounts' && ed.remarks === 'Edited remark' && Number(ed.net_amount) === 1000, JSON.stringify(ed))
await db.exec(edit(inv8, '', null, '   '))
const ed2 = (await q(`select document_no, party_note, remarks from commission_invoices where id='${inv8}'`))[0]
ok('empty values clear the fields', ed2.document_no === null && ed2.party_note === null && ed2.remarks === null, JSON.stringify(ed2))
err = await fails(edit(inv10, 'X', null, null)); ok('a cancelled invoice cannot be edited', err && err.includes('cancelled'), err)
err = await fails(edit(legacy, 'X', null, null)); ok('an old per-order invoice cannot be edited here', err && err.includes('old one-per-order'), err)
await as(clerk)
err = await fails(edit(inv8, 'X', null, null)); ok('editing needs order.manage', err && err.includes('permission'), err)
await as(admin)

// RLS: a user without permission sees no lines
await as(clerk)
await db.exec(`grant select on all tables in schema public to authenticated; grant usage on schema public to authenticated; set role authenticated`)
ok('RLS hides the lines from a user without order.read', (await q(`select count(*)::int n from commission_invoice_lines`))[0].n === 0)
ok('RLS hides the payments from a user without order.read', (await q(`select count(*)::int n from commission_invoice_payments`))[0].n === 0)
await db.exec(`reset role`)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
