-- Replaces the old agency name and e-mail in four QA test rows. Run once in the Supabase SQL editor.
--
-- companies_required_chk and companies_fmt_chk are checked on every UPDATE of a row, even though
-- they are NOT VALID. These old QA rows break them (no email/address/bank, a PAN or a phone in the
-- wrong format), so the same statement fills the missing required values with placeholders and
-- clears any PAN, GST number or phone that is not in the right format.

update public.companies set
  brand_name     = 'Sample Agency',
  email          = case when btrim(coalesce(email, '')) = '' or email ~* 'karthika' then 'agency@example.com' else email end,
  address        = case when btrim(coalesce(address, '')) = '' then 'Sample address' else address end,
  bank_account_1 = case when btrim(coalesce(bank_account_1, '')) = '' then 'Sample bank account' else bank_account_1 end,
  tax_id         = case when tax_id ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then tax_id end,
  pan_number     = case when pan_number ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'
                         and (tax_id is null or not (tax_id ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$') or substr(tax_id, 3, 10) = pan_number)
                        then pan_number end,
  phone_1        = case when phone_1 ~ '^\+[0-9]{1,3}[0-9]{6,12}$' then phone_1 end,
  phone_2        = case when phone_2 ~ '^\+[0-9]{1,3}[0-9]{6,12}$' then phone_2 end,
  phone_3        = case when phone_3 ~ '^\+[0-9]{1,3}[0-9]{6,12}$' then phone_3 end
 where id in ('a3bbc9df-501f-4188-9d91-50ac86dc4cff', 'a1a6f956-1c70-4892-89ba-c2f5757501a9', '8b2c79ce-eeaf-4dbb-ab55-3eed2a12ceb0')
   and (brand_name ~* 'kaarthika' or brand_name ~* 'karthika' or email ~* 'karthika');

update public.buyer_master set email = 'agency@example.com'
 where id = 'a7284ad0-2ce2-42aa-a9ae-6797462e5118' and email ~* 'karthika';

-- Check: this should return no rows.
select 'companies' as t, id::text from public.companies where brand_name ~* 'ka+r?th?i?ka|kaarthik|karthik' or email ~* 'karthik'
union all select 'buyer_master', id::text from public.buyer_master where email ~* 'karthik';
