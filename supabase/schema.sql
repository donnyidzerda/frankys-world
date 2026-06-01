-- =========================================================================
-- Franky's World - Supabase schema
--
-- Identity + durable storage layer. A family = one auth user (anonymous at
-- first; later linked to email/password or Google/Apple SSO so the account -
-- and therefore the data AND the premium entitlement - survives a wiped
-- device, a deleted PWA, or browser-data clearing). Each family owns N child
-- profiles; each profile holds the grow-only learning-state blob the app
-- already produces (syncSnapshot()).
--
-- Run this once in the Supabase SQL editor (or `supabase db push`). Safe to
-- re-run: every statement is idempotent.
-- =========================================================================

-- ---- profiles -----------------------------------------------------------
-- One row per child. `state` is the synced learning blob (stars, readBox,
-- completed, stickers, settings...). `client_ts` mirrors the app's syncTs so
-- the grow-only merge stays last-write-wins on true metadata. Device-local
-- data (gallery PNGs, readHeard voice transcripts) is NEVER stored here - the
-- app strips it via SYNC_OMIT before pushing.
create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text,
  age         int,
  lang        text,
  state       jsonb not null default '{}'::jsonb,
  client_ts   bigint not null default 0,
  updated_at  timestamptz not null default now()
);
create index if not exists profiles_user_id_idx on public.profiles(user_id);

-- ---- entitlements -------------------------------------------------------
-- One row per family (auth user). Written ONLY by the billing webhook using
-- the service-role key (which bypasses RLS). Clients can read their own row
-- but have no write policy, so a family can never grant itself premium.
-- `customer` = the Merchant-of-Record (Creem/Paddle) customer id; `txn` = the
-- one-time (lifetime) transaction id, kept so a later refund can revoke.
create table if not exists public.entitlements (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  premium     boolean not null default false,
  until       timestamptz,
  plan        text not null default '',
  customer    text,
  txn         text,
  updated_at  timestamptz not null default now()
);

-- A reverse lookup so a billing webhook (which only knows the MoR customer or
-- transaction id) can find the family to revoke on refund/chargeback. Written
-- by the service role only.
create table if not exists public.billing_links (
  ref         text primary key,            -- "cust:<id>" or "txn:<id>"
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- ---- keep updated_at honest --------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists entitlements_touch on public.entitlements;
create trigger entitlements_touch before update on public.entitlements
  for each row execute function public.touch_updated_at();

-- ---- Row-Level Security -------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.entitlements  enable row level security;
alter table public.billing_links enable row level security;

-- profiles: a family sees and edits only its own children. (auth.uid() is the
-- caller's user id; the anon-key client always carries it via the JWT.)
drop policy if exists profiles_owner_select on public.profiles;
create policy profiles_owner_select on public.profiles
  for select using (user_id = auth.uid());
drop policy if exists profiles_owner_insert on public.profiles;
create policy profiles_owner_insert on public.profiles
  for insert with check (user_id = auth.uid());
drop policy if exists profiles_owner_update on public.profiles;
create policy profiles_owner_update on public.profiles
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists profiles_owner_delete on public.profiles;
create policy profiles_owner_delete on public.profiles
  for delete using (user_id = auth.uid());

-- entitlements: read-only for the owner; writes happen only via service role
-- (which bypasses RLS). No client insert/update/delete policy on purpose.
drop policy if exists entitlements_owner_select on public.entitlements;
create policy entitlements_owner_select on public.entitlements
  for select using (user_id = auth.uid());

-- billing_links: no client access at all (service role only). RLS on with no
-- policy => clients are denied; the service role still bypasses it.

-- ---- Realtime -----------------------------------------------------------
-- Push profile changes to a family's other devices in real time. (Added
-- defensively: ignore the error if the table is already in the publication.)
do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.entitlements;
exception when duplicate_object then null;
end $$;
