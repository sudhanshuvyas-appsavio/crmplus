-- Replaces the old agency name and e-mail in four QA test rows. Run once in the Supabase SQL editor.
--
-- companies_required_chk (name, email, address and bank account 1 all filled) is checked on every
-- UPDATE of a row, even though the constraint is NOT VALID. These three old QA rows lack some of
-- those values, so the same statement also gives them a placeholder for each missing one.

update public.companies set
  brand_name     = 'Sample Agency',
  email          = case when btrim(coalesce(email, '')) = '' or email ~* 'karthika' then 'agency@example.com' else email end,
  address        = case when btrim(coalesce(address, '')) = '' then 'Sample address' else address end,
  bank_account_1 = case when btrim(coalesce(bank_account_1, '')) = '' then 'Sample bank account' else bank_account_1 end
 where id in ('a3bbc9df-501f-4188-9d91-50ac86dc4cff', 'a1a6f956-1c70-4892-89ba-c2f5757501a9', '8b2c79ce-eeaf-4dbb-ab55-3eed2a12ceb0')
   and brand_name ~* 'kaarthika';

update public.buyer_master set email = 'agency@example.com'
 where id = 'a7284ad0-2ce2-42aa-a9ae-6797462e5118' and email ~* 'karthika';

-- Check: this should return no rows.
select 'companies' as t, id::text from public.companies where brand_name ~* 'kaarthika' or email ~* 'karthika'
union all select 'buyer_master', id::text from public.buyer_master where email ~* 'karthika';
