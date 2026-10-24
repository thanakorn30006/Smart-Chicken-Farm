-- Smart Chicken Farm: paste this whole file into Supabase > SQL Editor > Run.

-- History of sensor readings (one row per upload)
create table if not exists readings (
  id         bigint generated always as identity primary key,
  house      smallint not null check (house between 1 and 3),
  temp       real not null,
  humidity   real not null,
  created_at timestamptz not null default now()
);
create index if not exists readings_house_time on readings (house, created_at desc);

-- Current desired LED state (exactly one row per house)
create table if not exists leds (
  house smallint primary key check (house between 1 and 3),
  state boolean not null default false
);
insert into leds (house) values (1), (2), (3) on conflict do nothing;

-- Row Level Security: the anon key (used by ESP32 and the web page) gets only what it needs.
alter table readings enable row level security;
alter table leds     enable row level security;

drop policy if exists "readings read"   on readings;
drop policy if exists "readings insert" on readings;
drop policy if exists "leds read"       on leds;
drop policy if exists "leds update"     on leds;

create policy "readings read"   on readings for select to anon using (true);
create policy "readings insert" on readings for insert to anon with check (true);
create policy "leds read"       on leds     for select to anon using (true);
create policy "leds update"     on leds     for update to anon using (true) with check (true);

-- No delete policy on purpose: nobody with the anon key can erase history.

-- Light switch history: a trigger logs every change of leds.state, whoever made it.
create table if not exists led_events (
  id         bigint generated always as identity primary key,
  house      smallint not null,
  state      boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists led_events_time on led_events (created_at desc);
alter table led_events enable row level security;
drop policy if exists "led_events read" on led_events;
create policy "led_events read" on led_events for select to anon using (true);

-- security definer: the log is written by the function owner, so anon needs no insert right on led_events.
create or replace function log_led_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into led_events (house, state) values (new.house, new.state);
  return new;
end $$;

drop trigger if exists leds_log on leds;
create trigger leds_log after update on leds
  for each row when (old.state is distinct from new.state)
  execute function log_led_change();
