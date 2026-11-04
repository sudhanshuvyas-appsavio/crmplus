
create table if not exists public.count_master (
    id            uuid primary key default gen_random_uuid(),
    count_no      integer not null check (count_no between 6 and 120),
    machine       text not null check (machine in ('OE', 'RING SPUN', 'VORTEX')),
    composition   text not null check (composition in ('COTTON', 'POLYESTER', 'VISCOSE', 'LINEN', 'HEMP', 'BLENDED')),
    ratio         text not null check (ratio ~ '^[0-9]{1,3}(%|(/[0-9]{1,3})+)$'),
    blended       text check (blended is null or blended in ('COTTON/POLYESTER', 'COTTON/VISCOSE')),
    yarn_type     text not null check (yarn_type in ('CHEESE', 'CONE')),
    process       text check (process is null or process in ('COMBED', 'KARDED', 'KARDED COMPACT', 'COMBED COMPACT')),
    certification text check (certification is null or certification in ('BCI', 'OEKO TEX', 'GOTS', 'NPOP', 'NOP')),
    ply           text check (ply is null or ply in ('SINGLE', 'DOUBLE')),
    display_name  text not null default '',
    is_active     boolean not null default true,
    created_by    uuid references public.profiles (id),
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    constraint count_master_blended_rule check ((composition = 'BLENDED') = (blended is not null))
);
create unique index if not exists count_master_display_uq on public.count_master (upper(display_name));
alter table public.count_master enable row level security;
