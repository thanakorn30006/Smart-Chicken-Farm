-- Smart Chicken Farm v3.3 (many farms, many coops, users & roles: admin > farm keeper > coop keeper): paste this whole file into Supabase > SQL Editor > Run.
-- Safe to run on a new project AND on older versions of this project: it migrates and keeps all history.
-- Run it again after every update of this file.
--
-- Who can touch the data:
--   only Node-RED (secret key in .env on the server). It checks every user's role and farm before each query.
--   The anon/publishable key has no access at all.

-- =========================================================================================
-- 1. Farm structure: farms -> gateways (ESP32 ตัวแม่) -> coops (โรงเรือน, one ESP32 ตัวลูก each)
-- =========================================================================================
create table if not exists farms (
  id         bigint generated always as identity primary key,
  name       text not null check (length(trim(name)) between 1 and 80),
  location   text check (location is null or length(location) <= 120),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- v3.3: the farm key (ESP-NOW HMAC, FARM_KEY in every board of the farm), kept so the web can hand out
-- ready-to-flash board files at any time. Only Node-RED (secret key) can read it.
alter table farms add column if not exists farm_key text check (farm_key is null or farm_key ~ '^[0-9a-f]{32}$');

create table if not exists gateways (
  id         bigint generated always as identity primary key,
  farm_id    bigint not null references farms(id),
  name       text not null check (length(trim(name)) between 1 and 60),
  mqtt_user  text not null unique check (mqtt_user ~ '^gw[a-z0-9-]{1,30}$'),   -- MQTT username = topic prefix scf/<mqtt_user>/
  active     boolean not null default true,
  last_seen  timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists coops (
  id         bigint generated always as identity primary key,
  farm_id    bigint not null references farms(id),
  name       text not null check (length(trim(name)) between 1 and 60),
  capacity   integer check (capacity is null or capacity between 1 and 1000000),
  gateway_id bigint references gateways(id),
  node_id    smallint check (node_id between 1 and 20),                       -- NODE_ID flashed into the coop's ESP32
  light_mode text not null default 'manual' check (light_mode in ('manual', 'auto')),
  light_on   text not null default '06:00' check (light_on  ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  light_off  text not null default '22:00' check (light_off ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((gateway_id is null) = (node_id is null))
);
-- one active coop per (gateway, node): two coops can never receive the same sensor
create unique index if not exists coops_gateway_node on coops (gateway_id, node_id) where active and gateway_id is not null;
create index if not exists coops_farm on coops (farm_id);

-- a coop may only use a gateway of its own farm
create or replace function check_coop_gateway() returns trigger language plpgsql as $$
begin
  if new.gateway_id is not null and not exists (select 1 from gateways g where g.id = new.gateway_id and g.farm_id = new.farm_id) then
    raise exception 'gateway % is not in farm %', new.gateway_id, new.farm_id using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists coops_gateway_check on coops;
create trigger coops_gateway_check before insert or update on coops for each row execute function check_coop_gateway();

-- =========================================================================================
-- 2. Users. admin = every farm · keeper (ผู้ดูแลฟาร์ม), coop_keeper (ผู้ดูแลโรงเรือน) and viewer = exactly ONE farm
--    (enforced by the database itself). A coop keeper also looks after one or more coops of that farm (user_coops).
--    Node-RED refuses to leave a farm without an active keeper.
-- =========================================================================================
create table if not exists users (
  id              bigint generated always as identity primary key,
  username        text not null unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  display_name    text not null check (length(trim(display_name)) between 1 and 60),
  password_hash   text not null,                          -- scrypt$salt$hash (made by Node-RED, never plain text)
  role            text not null constraint users_role_check check (role in ('admin', 'keeper', 'coop_keeper', 'viewer')),
  farm_id         bigint references farms(id),
  active          boolean not null default true,
  session_version integer not null default 0,             -- +1 = every token issued before is invalid
  failed_logins   integer not null default 0,
  locked_until    timestamptz,
  last_login      timestamptz,
  created_at      timestamptz not null default now(),
  constraint users_one_farm check ((role = 'admin' and farm_id is null) or (role <> 'admin' and farm_id is not null))
);
create index if not exists users_farm on users (farm_id);

-- v3.3 2-step login (TOTP: Google/Microsoft Authenticator). Required for admin + farm keeper by default (MFA_REQUIRED_ROLES).
--   totp_secret: AES-256-GCM sealed by Node-RED (key from SESSION_SECRET), never plain · mfa_backup: HMACs of one-time backup codes
alter table users add column if not exists totp_secret    text;
alter table users add column if not exists totp_enabled   boolean not null default false;
alter table users add column if not exists totp_last_step bigint;
alter table users add column if not exists mfa_backup     jsonb;

-- coop keeper (ผู้ดูแลโรงเรือน) -> the coops he/she looks after (one or more, all in his/her own farm)
create table if not exists user_coops (
  user_id    bigint not null references users(id) on delete cascade,
  coop_id    bigint not null references coops(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, coop_id)
);
create index if not exists user_coops_coop on user_coops (coop_id);

-- older versions -> v3.3
--   v3:   หัวหน้าฟาร์ม (manager) + พนักงานเลี้ยง (worker) -> ผู้ดูแลฟาร์ม (keeper) ของฟาร์มเดิม
--   v3.1: ผู้ดูแลโรงเรือน (keeper with coop_id)        -> ผู้ดูแลโรงเรือน (coop_keeper) ของโรงเรือนเดิม
--   everyone moved has to log in again (session_version + 1)
alter table users drop constraint if exists users_one_coop;
alter table users drop constraint if exists users_one_farm;
alter table users drop constraint if exists users_role_check;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'coop_id') then
    execute $q$update users u set role = 'coop_keeper', farm_id = c.farm_id, session_version = u.session_version + 1
                from coops c where u.coop_id = c.id and u.role not in ('admin', 'manager')$q$;
    execute $q$insert into user_coops (user_id, coop_id) select id, coop_id from users
                where role = 'coop_keeper' and coop_id is not null on conflict do nothing$q$;
    execute 'alter table users drop column coop_id';
  end if;
end $$;
update users set role = 'keeper', session_version = session_version + 1 where role in ('manager', 'worker');
update users set farm_id = (select min(id) from farms where active) where role <> 'admin' and farm_id is null;
update users set farm_id = null where role = 'admin';
alter table users add constraint users_role_check check (role in ('admin', 'keeper', 'coop_keeper', 'viewer'));
alter table users add constraint users_one_farm check ((role = 'admin' and farm_id is null) or (role <> 'admin' and farm_id is not null));

-- a coop can only be given to a coop keeper of the same farm
create or replace function check_user_coop() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from users u join coops c on c.farm_id = u.farm_id
                 where u.id = new.user_id and c.id = new.coop_id and u.role = 'coop_keeper') then
    raise exception 'coop % cannot be given to user %', new.coop_id, new.user_id using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists user_coops_check on user_coops;
create trigger user_coops_check before insert or update on user_coops for each row execute function check_user_coop();

-- no longer a coop keeper, or moved to another farm -> loses the coops
create or replace function drop_user_coops() returns trigger language plpgsql as $$
begin
  if new.role <> 'coop_keeper' or new.farm_id is distinct from old.farm_id then
    delete from user_coops where user_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists users_drop_coops on users;
create trigger users_drop_coops after update of role, farm_id on users for each row execute function drop_user_coops();

-- Who did what, when (login, light commands, settings, user management, unknown devices ...)
create table if not exists audit_log (
  id         bigint generated always as identity primary key,
  user_id    bigint references users(id) on delete set null,
  username   text,
  farm_id    bigint references farms(id) on delete set null,
  action     text not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_time on audit_log (created_at desc);
create index if not exists audit_farm_time on audit_log (farm_id, created_at desc);

-- =========================================================================================
-- 3. Data tables (all keyed by coop_id)
-- =========================================================================================
create table if not exists readings (
  id         bigint generated always as identity primary key,
  coop_id    bigint references coops(id),
  temp       real not null,
  humidity   real not null,
  created_at timestamptz not null default now()
);
create table if not exists led_events (
  id         bigint generated always as identity primary key,
  coop_id    bigint references coops(id),
  state      boolean not null,
  created_at timestamptz not null default now()
);
create table if not exists flocks (
  id         bigint generated always as identity primary key,
  coop_id    bigint references coops(id),
  started_on date not null,
  birds      integer not null check (birds > 0),
  breed      text not null default 'ไก่เนื้อ',
  ended_on   date,
  created_at timestamptz not null default now()
);
create table if not exists daily_logs (
  id           bigint generated always as identity primary key,
  flock_id     bigint not null references flocks(id) on delete cascade,
  coop_id      bigint references coops(id),
  log_date     date not null,
  deaths       integer not null default 0 check (deaths >= 0),
  feed_kg      real not null default 0 check (feed_kg >= 0),
  avg_weight_g real check (avg_weight_g > 0),
  note         text,
  created_by   bigint references users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (flock_id, log_date)
);
create table if not exists alerts (
  id         bigint generated always as identity primary key,
  farm_id    bigint references farms(id),
  coop_id    bigint references coops(id),
  level      text not null,
  message    text not null,
  temp       real,
  humidity   real,
  created_at timestamptz not null default now()
);

-- older versions: add the new columns
alter table readings   add column if not exists coop_id bigint references coops(id);
alter table led_events add column if not exists coop_id bigint references coops(id);
alter table flocks     add column if not exists coop_id bigint references coops(id);
alter table daily_logs add column if not exists coop_id bigint references coops(id);
alter table daily_logs add column if not exists created_by bigint references users(id) on delete set null;
alter table alerts     add column if not exists coop_id bigint references coops(id);
alter table alerts     add column if not exists farm_id bigint references farms(id);

-- =========================================================================================
-- 4. Migration from v1/v2 (houses 1-3) -> "ฟาร์มหลัก" with gateway gw1 and coops for nodes 1-3
-- =========================================================================================
do $$
declare f bigint; g bigint; t text;
begin
  if not exists (select 1 from farms) then
    insert into farms (name) values ('ฟาร์มหลัก') returning id into f;
    insert into gateways (farm_id, name, mqtt_user) values (f, 'Gateway หลัก', 'gw1') returning id into g;
    if to_regclass('public.house_settings') is not null then
      execute format($q$insert into coops (farm_id, name, gateway_id, node_id, light_mode, light_on, light_off)
        select %s, 'โรงเรือน ' || h, %s, h, coalesce(s.light_mode, 'manual'), coalesce(s.light_on, '06:00'), coalesce(s.light_off, '22:00')
        from generate_series(1, 3) h left join house_settings s on s.house = h order by h$q$, f, g);
    else
      insert into coops (farm_id, name, gateway_id, node_id) select f, 'โรงเรือน ' || h, g, h from generate_series(1, 3) h order by h;
    end if;
  end if;

  -- old rows have "house" 1-3: point them at the coop with that node number on the first gateway
  foreach t in array array['readings', 'led_events', 'flocks', 'daily_logs', 'alerts'] loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'house') then
      execute format('alter table %I alter column house drop not null', t);
      execute format($q$update %I x set coop_id = c.id from coops c
        where x.coop_id is null and x.house is not null and c.node_id = x.house
          and c.gateway_id = (select min(id) from gateways)$q$, t);
    end if;
  end loop;
  update alerts a set farm_id = c.farm_id from coops c where a.farm_id is null and a.coop_id = c.id;
end $$;

-- remove what the old versions used and v3 replaces
drop view     if exists farm_state;
drop table    if exists house_settings;
drop index    if exists flocks_one_active;
drop function if exists start_flock(smallint, date, integer, text);
drop function if exists end_flock(smallint);
do $$ begin
  if to_regclass('public.leds') is not null then execute 'drop trigger if exists leds_log on leds'; end if;
end $$;
drop function if exists log_led_change();
drop table    if exists leds;

-- =========================================================================================
-- 5. Indexes, views and functions used by Node-RED
-- =========================================================================================
create index if not exists readings_coop_time   on readings (coop_id, created_at desc);
create index if not exists led_events_coop_time on led_events (coop_id, created_at desc);
create index if not exists alerts_farm_time     on alerts (farm_id, created_at desc);
create index if not exists daily_logs_flock     on daily_logs (flock_id, log_date desc);
create unique index if not exists flocks_one_active_coop on flocks (coop_id) where ended_on is null;

drop view if exists latest_readings;
create view latest_readings with (security_invoker = true) as
  select distinct on (coop_id) coop_id, temp, humidity, created_at
  from readings where coop_id is not null
  order by coop_id, created_at desc;

-- every coop with its gateway, active flock and running totals (Node-RED caches this)
drop view if exists coop_state;
create view coop_state with (security_invoker = true) as
select c.id, c.farm_id, c.name, c.capacity, c.gateway_id, g.mqtt_user, c.node_id,
       c.light_mode, c.light_on, c.light_off, c.active,
       f.id as flock_id, f.started_on, f.birds, f.breed,
       coalesce(d.deaths, 0) as deaths, coalesce(d.feed_kg, 0) as feed_kg, d.last_log_date, w.avg_weight_g
from coops c
left join gateways g on g.id = c.gateway_id
left join lateral (select * from flocks where coop_id = c.id and ended_on is null order by started_on desc, id desc limit 1) f on true
left join lateral (select sum(deaths)::int as deaths, sum(feed_kg)::real as feed_kg, max(log_date) as last_log_date
                   from daily_logs where flock_id = f.id) d on true
left join lateral (select avg_weight_g from daily_logs where flock_id = f.id and avg_weight_g is not null
                   order by log_date desc limit 1) w on true;

create or replace function start_flock(p_coop bigint, p_started_on date, p_birds integer, p_breed text)
returns flocks language plpgsql as $$
declare r flocks;
begin
  update flocks set ended_on = greatest(current_date, started_on) where coop_id = p_coop and ended_on is null;
  insert into flocks (coop_id, started_on, birds, breed)
  values (p_coop, p_started_on, p_birds, coalesce(nullif(trim(p_breed), ''), 'ไก่เนื้อ'))
  returning * into r;
  return r;
end $$;

create or replace function end_flock(p_coop bigint)
returns void language sql as $$
  update flocks set ended_on = greatest(current_date, started_on) where coop_id = p_coop and ended_on is null;
$$;

-- delete a coop with everything recorded about it (readings, lights, flocks, daily records, alerts) in one go.
create or replace function delete_coop(p_coop bigint)
returns void language plpgsql as $$
begin
  delete from daily_logs where coop_id = p_coop or flock_id in (select id from flocks where coop_id = p_coop);
  delete from flocks     where coop_id = p_coop;
  delete from readings   where coop_id = p_coop;
  delete from led_events where coop_id = p_coop;
  delete from alerts     where coop_id = p_coop;
  delete from coops      where id = p_coop;
end $$;

-- delete a farm with everything in it: its coops (and their history), gateways, alerts and the accounts of its
-- keepers/coop keepers/viewers. One transaction: all or nothing. Audit rows stay (farm_id becomes null).
create or replace function delete_farm(p_farm bigint)
returns void language plpgsql as $$
declare c bigint;
begin
  for c in select id from coops where farm_id = p_farm loop
    perform delete_coop(c);
  end loop;
  delete from alerts   where farm_id = p_farm;
  delete from users    where farm_id = p_farm and role <> 'admin';
  delete from gateways where farm_id = p_farm;
  delete from farms    where id = p_farm;
end $$;

-- =========================================================================================
-- 6. Access: Row Level Security on, no policy for anon = anon can do nothing
-- =========================================================================================
alter table farms      enable row level security;
alter table gateways   enable row level security;
alter table coops      enable row level security;
alter table users      enable row level security;
alter table user_coops enable row level security;
alter table audit_log  enable row level security;
alter table readings   enable row level security;
alter table led_events enable row level security;
alter table flocks     enable row level security;
alter table daily_logs enable row level security;
alter table alerts     enable row level security;
drop policy if exists "readings read"   on readings;
drop policy if exists "readings insert" on readings;
drop policy if exists "led_events read" on led_events;
revoke all on farms, gateways, coops, users, user_coops, audit_log, readings, led_events, flocks, daily_logs, alerts,
              latest_readings, coop_state from anon, authenticated;
revoke execute on function start_flock(bigint, date, integer, text) from public, anon, authenticated;
revoke execute on function end_flock(bigint) from public, anon, authenticated;
revoke execute on function check_coop_gateway() from public, anon, authenticated;
revoke execute on function check_user_coop() from public, anon, authenticated;
revoke execute on function drop_user_coops() from public, anon, authenticated;
revoke execute on function delete_coop(bigint) from public, anon, authenticated;
grant  execute on function delete_coop(bigint) to service_role;
revoke execute on function delete_farm(bigint) from public, anon, authenticated;
grant  execute on function delete_farm(bigint) to service_role;
grant  execute on function start_flock(bigint, date, integer, text) to service_role;
grant  execute on function end_flock(bigint) to service_role;
-- The secret key (service_role) bypasses RLS, so Node-RED needs no policy.
