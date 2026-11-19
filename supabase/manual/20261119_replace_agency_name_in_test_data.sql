-- Replaces the old agency name and e-mail in four QA test rows. Run once in the Supabase SQL editor.
update public.companies set brand_name = 'Sample Agency'
 where id in ('a3bbc9df-501f-4188-9d91-50ac86dc4cff', 'a1a6f956-1c70-4892-89ba-c2f5757501a9', '8b2c79ce-eeaf-4dbb-ab55-3eed2a12ceb0')
   and brand_name ~* 'kaarthika';
update public.companies set email = 'agency@example.com' where id = 'a1a6f956-1c70-4892-89ba-c2f5757501a9' and email ~* 'karthika';
update public.buyer_master set email = 'agency@example.com' where id = 'a7284ad0-2ce2-42aa-a9ae-6797462e5118' and email ~* 'karthika';
