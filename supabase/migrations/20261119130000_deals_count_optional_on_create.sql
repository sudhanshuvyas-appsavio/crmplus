-- Deals: a deal can be created with only monday's Deal Creation Form fields (Name, Owner, Status,
-- Leads); its count and quantity are added afterwards (Actions > Edit), as on monday's board.
--
-- 1. crm_deals.count_id and crm_deals.quantity may be empty until the counts are entered.
--    Everything that reads them already copes with empty values:
--      crm_deals_derive            weight, value and commissions come out empty
--      crm_deals_first_line        only adds the first count row when a count and quantity exist
--      crm_deals_line_totals       does nothing while the deal has no count rows
--      deal_confirm_problems       already lists "Count is missing" / "Quantity is missing"
-- 2. A deal still cannot be sent for approval (and so cannot be approved or become a Sales
--    Confirmation) without a count and quantity: crm_deals_status_guard now says so.
-- Existing deals, ids and numbers are untouched.

begin;

alter table public.crm_deals alter column count_id drop not null;
alter table public.crm_deals alter column quantity drop not null;

create or replace function public.crm_deals_status_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare linking boolean := coalesce(current_setting('app.confirming', true),'') = '1';
begin
  new.approved_at := old.approved_at; new.approved_by := old.approved_by;
  new.supplier_confirmed_at := old.supplier_confirmed_at; new.supplier_confirmed_by := old.supplier_confirmed_by;
  new.buyer_confirmed_at := old.buyer_confirmed_at; new.buyer_confirmed_by := old.buyer_confirmed_by;
  new.approval_margin_pct := old.approval_margin_pct;
  if not linking then
    new.sales_confirmation_id := old.sales_confirmation_id;
    new.confirmed_at := old.confirmed_at; new.confirmed_by := old.confirmed_by;
  end if;
  new.status_changed_at := old.status_changed_at;

  if new.status is distinct from old.status then
    if old.status = 'approved' then
      if not is_admin() then raise exception 'Only an administrator can move an Approved deal back'; end if;
      if old.sales_confirmation_id is not null then raise exception 'This deal already has a Sales Confirmation and cannot leave Approved'; end if;
    end if;
    case new.status
      when 'manager_approval' then
        if old.status not in ('new_deal','reconsider','approved') then raise exception 'Only a New Deal or one sent to Reconsider can go for Manager Approval'; end if;
        if new.buyer_id is null then raise exception 'Pick the buyer from Buyers & Suppliers before sending the deal for approval'; end if;
        if new.supplier_id is null then raise exception 'Choose the supplier before sending the deal for approval'; end if;
        if new.count_id is null or new.quantity is null or new.quantity <= 0 then raise exception 'Add the count and quantity before sending the deal for approval'; end if;
        if new.final_rate is null or new.final_rate <= 0 then raise exception 'Enter the final rate before sending the deal for approval'; end if;
      when 'approved' then
        if not has_permission('deal.approve') then raise exception 'You need the "Approve deals" permission to approve a deal'; end if;
        if old.status <> 'manager_approval' then raise exception 'Only a deal in Manager Approval can be approved'; end if;
        if new.buyer_id is null or new.supplier_id is null or new.count_id is null or new.quantity is null or new.final_rate is null or new.final_rate <= 0 then
          raise exception 'The buyer, supplier, count, quantity and final rate are needed before approval';
        end if;
        new.approved_at := now(); new.approved_by := auth.uid();
        new.manager_id := coalesce(new.manager_id, auth.uid());
      when 'reconsider' then
        if not has_permission('deal.approve') then raise exception 'You need the "Approve deals" permission to send a deal back'; end if;
        if old.status <> 'manager_approval' then raise exception 'Only a deal in Manager Approval can be sent to Reconsider'; end if;
      when 'closed_lost' then
        null;
      when 'new_deal' then
        null;
      else
        raise exception 'Unknown deal status %', new.status;
    end case;
    if new.status <> 'approved' then new.approved_at := null; new.approved_by := null; end if;
    if new.status <> 'closed_lost' then new.lost_reason := null; end if;
    new.status_changed_at := now();
  elsif old.status = 'approved' and not linking and (
       new.buyer_id is distinct from old.buyer_id or new.supplier_id is distinct from old.supplier_id
    or new.company_id is distinct from old.company_id or new.count_id is distinct from old.count_id
    or new.quantity is distinct from old.quantity or new.uom is distinct from old.uom or new.bag_weight is distinct from old.bag_weight
    or new.final_rate is distinct from old.final_rate or new.payment_term_id is distinct from old.payment_term_id
    or new.freight is distinct from old.freight or new.price_basis is distinct from old.price_basis
    or new.buyer_comm_basis is distinct from old.buyer_comm_basis or new.buyer_comm_value is distinct from old.buyer_comm_value
    or new.supplier_comm_basis is distinct from old.supplier_comm_basis or new.supplier_comm_value is distinct from old.supplier_comm_value) then
    raise exception 'This deal is Approved and its terms are locked';
  end if;
  return new;
end $function$;

commit;
