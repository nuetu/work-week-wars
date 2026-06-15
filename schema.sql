-- Work Week Wars — database schema. Run this in the Supabase SQL editor to set up
-- a fresh project. Enables Realtime + Row Level Security on all four game tables.
--
-- Tables are prefixed www_ so this game's data is easy to tell apart from other
-- projects sharing the same Supabase instance. The project_info table documents
-- which tables belong to which project.

create table if not exists www_rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,        -- 4-letter join code
  phase       text not null default 'lobby',
  round       int  not null default 1,
  meeting_hrs float not null default 0,     -- daily meeting hrs set by Michael
  created_at  timestamptz default now()
);

create table if not exists www_players (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid references www_rooms(id) on delete cascade,
  role         text not null,               -- michael | dwight | pam | toby | oscar
  display_name text not null,
  locked_r1    bool not null default false,
  locked_r2    bool not null default false,
  r1_burnout   float,                       -- round-1 burnout, for the round-2 carryover
  joined_at    timestamptz default now()
);

create table if not exists www_schedules (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid references www_players(id) on delete cascade,
  round         int  not null,              -- 1 or 2
  deep_work_hrs float not null default 0,   -- hours per day
  admin_hrs     float not null default 0,
  learning_hrs  float not null default 0,
  rest_hrs      float not null default 0,
  submitted_at  timestamptz default now(),
  unique (player_id, round)
);

create table if not exists www_targets (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid references www_rooms(id) on delete cascade,
  round            int  not null,
  player_role      text not null,           -- which role this target applies to
  deep_work_target float not null default 0,-- hrs/day Michael wants from this role
  unique (room_id, round, player_role)
);

-- Privileges for the public (anon) clients.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on www_rooms, www_players, www_schedules, www_targets to anon, authenticated;

-- Row Level Security ------------------------------------------------------
alter table www_rooms     enable row level security;
alter table www_players   enable row level security;
alter table www_schedules enable row level security;
alter table www_targets   enable row level security;

-- rooms: anyone with the code can read; host creates rooms / advances phase.
drop policy if exists rooms_read  on www_rooms;
drop policy if exists rooms_write on www_rooms;
create policy rooms_read  on www_rooms for select using (true);
create policy rooms_write on www_rooms for all    using (true) with check (true);

-- players: roster + lock flags visible to all in the room.
drop policy if exists players_read  on www_players;
drop policy if exists players_write on www_players;
create policy players_read  on www_players for select using (true);
create policy players_write on www_players for all    using (true) with check (true);

-- targets: Michael writes; clients read (app filters to own role).
drop policy if exists targets_read  on www_targets;
drop policy if exists targets_write on www_targets;
create policy targets_read  on www_targets for select using (true);
create policy targets_write on www_targets for all    using (true) with check (true);

-- schedules: anyone may submit/update their row, but rows are only READABLE
-- once the room reaches a reveal phase. This stops phones from reading other
-- players' allocations during play.
drop policy if exists schedules_insert on www_schedules;
drop policy if exists schedules_update on www_schedules;
drop policy if exists schedules_read   on www_schedules;
create policy schedules_insert on www_schedules for insert with check (true);
create policy schedules_update on www_schedules for update using (true) with check (true);
create policy schedules_read on www_schedules for select using (
  exists (
    select 1 from www_players p
    join www_rooms r on r.id = p.room_id
    where p.id = www_schedules.player_id
      and r.phase in ('reveal', 'final')
  )
);

-- Realtime ----------------------------------------------------------------
alter publication supabase_realtime add table www_rooms;
alter publication supabase_realtime add table www_players;
alter publication supabase_realtime add table www_schedules;
alter publication supabase_realtime add table www_targets;

-- Project registry --------------------------------------------------------
create table if not exists project_info (
  table_name  text primary key,
  project     text not null,
  description text
);
alter table project_info enable row level security;
drop policy if exists project_info_read on project_info;
create policy project_info_read on project_info for select using (true);
grant select on project_info to anon, authenticated;

insert into project_info (table_name, project, description) values
  ('www_rooms',     'Work Week Wars', 'Game rooms: 4-letter join code, current phase, round, and Michael''s daily meeting hours.'),
  ('www_players',   'Work Week Wars', 'Players in a room: assigned The Office role, display name, and per-round lock status.'),
  ('www_schedules', 'Work Week Wars', 'Each player''s per-day hour allocation (deep work / admin / learning / rest) for a round.'),
  ('www_targets',   'Work Week Wars', 'Michael''s deep-work target (hrs/day) per role, per round.'),
  ('project_info',  'Shared',         'This registry: documents which tables belong to which project.')
on conflict (table_name) do update
  set project = excluded.project, description = excluded.description;
