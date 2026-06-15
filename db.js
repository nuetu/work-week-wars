// db.js — data access + realtime helpers shared by play.js and screen.js.
// Keeps Supabase queries in one place; game.js stays pure (no network).
//
// Tables are prefixed www_ so this game's data is easy to tell apart from other
// projects in the same Supabase instance (see the project_info registry table).

import { supabase } from './supabase.js'
import { ROLE_ORDER, makeRoomCode, roundForPhase } from './game.js'

const T = {
  rooms: 'www_rooms',
  players: 'www_players',
  schedules: 'www_schedules',
  targets: 'www_targets',
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export async function createRoom() {
  // Try a few codes in case of a (rare) collision on the unique index.
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = makeRoomCode()
    const { data, error } = await supabase
      .from(T.rooms)
      .insert({ code, phase: 'lobby', round: 1, meeting_hrs: 0 })
      .select()
      .single()
    if (!error) return data
    if (error.code !== '23505') throw error // not a unique-violation → real error
  }
  throw new Error('Could not allocate a unique room code, try again.')
}

export async function getRoomById(roomId) {
  const { data, error } = await supabase.from(T.rooms).select('*').eq('id', roomId).maybeSingle()
  if (error) throw error
  return data
}

export async function getRoomByCode(code) {
  const { data, error } = await supabase
    .from(T.rooms)
    .select('*')
    .eq('code', code.toUpperCase())
    .maybeSingle()
  if (error) throw error
  return data
}

export async function setPhase(roomId, phase) {
  const round = roundForPhase(phase)
  const { error } = await supabase.from(T.rooms).update({ phase, round }).eq('id', roomId)
  if (error) throw error
}

export async function setMeetingHrs(roomId, hrs) {
  const { error } = await supabase.from(T.rooms).update({ meeting_hrs: hrs }).eq('id', roomId)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export async function getPlayers(roomId) {
  const { data, error } = await supabase
    .from(T.players)
    .select('*')
    .eq('room_id', roomId)
    .order('joined_at', { ascending: true })
  if (error) throw error
  return data || []
}

// Join a room: the first 5 lobby joiners get roles in order (Michael → Dwight → …);
// anyone after that, or anyone joining once the game has started, becomes a spectator.
// Returns { player }.
export async function joinRoom(room, displayName) {
  const existing = await getPlayers(room.id)
  const realCount = existing.filter((p) => ROLE_ORDER.includes(p.role)).length
  const role =
    room.phase === 'lobby' && realCount < ROLE_ORDER.length ? ROLE_ORDER[realCount] : 'spectator'
  const { data, error } = await supabase
    .from(T.players)
    .insert({ room_id: room.id, role, display_name: displayName })
    .select()
    .single()
  if (error) throw error
  return { player: data }
}

export async function setLock(playerId, round, locked) {
  const col = round === 1 ? 'locked_r1' : 'locked_r2'
  const { error } = await supabase
    .from(T.players)
    .update({ [col]: locked })
    .eq('id', playerId)
  if (error) throw error
}

// Record a player's round-1 burnout so round 2 can apply the carryover.
export async function setR1Burnout(playerId, burnout) {
  const { error } = await supabase.from(T.players).update({ r1_burnout: burnout }).eq('id', playerId)
  if (error) throw error
}

// Reset the lock flag for everyone in a room (used entering a round).
export async function resetLocks(roomId, round) {
  const col = round === 1 ? 'locked_r1' : 'locked_r2'
  const { error } = await supabase.from(T.players).update({ [col]: false }).eq('room_id', roomId)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

export async function saveSchedule(playerId, round, schedule) {
  // We can't UPSERT here: PostgREST upsert uses INSERT ... ON CONFLICT DO UPDATE,
  // whose conflict path must READ the target row — but the schedules SELECT policy
  // is locked until the reveal phase. So insert first, and fall back to a direct
  // UPDATE (which needs no SELECT) if this (player, round) row already exists.
  const fields = {
    deep_work_hrs: schedule.deep_work_hrs,
    admin_hrs: schedule.admin_hrs,
    learning_hrs: schedule.learning_hrs,
    rest_hrs: schedule.rest_hrs,
    submitted_at: new Date().toISOString(),
  }
  const ins = await supabase.from(T.schedules).insert({ player_id: playerId, round, ...fields })
  if (!ins.error) return
  if (ins.error.code !== '23505') throw ins.error // not a duplicate → real error
  const { error } = await supabase
    .from(T.schedules)
    .update(fields)
    .eq('player_id', playerId)
    .eq('round', round)
  if (error) throw error
}

// All schedules for a room + round, keyed by player_id. RLS only returns rows
// once the room is in a reveal phase.
export async function getSchedules(roomId, round) {
  const players = await getPlayers(roomId)
  const ids = players.map((p) => p.id)
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from(T.schedules)
    .select('*')
    .eq('round', round)
    .in('player_id', ids)
  if (error) throw error
  return data || []
}

// ---------------------------------------------------------------------------
// Targets (Michael's per-role deep-work targets)
// ---------------------------------------------------------------------------

// targetsByRole: { dwight: 4, pam: 2, ... } in hrs/day.
export async function saveTargets(roomId, round, targetsByRole) {
  const rows = Object.entries(targetsByRole).map(([player_role, deep_work_target]) => ({
    room_id: roomId,
    round,
    player_role,
    deep_work_target,
  }))
  const { error } = await supabase
    .from(T.targets)
    .upsert(rows, { onConflict: 'room_id,round,player_role' })
  if (error) throw error
}

export async function getTargets(roomId, round) {
  const { data, error } = await supabase
    .from(T.targets)
    .select('*')
    .eq('room_id', roomId)
    .eq('round', round)
  if (error) throw error
  const map = {}
  for (const t of data || []) map[t.player_role] = t.deep_work_target
  return map
}

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

// Subscribe to phase / meeting changes on a room. cb receives the new row.
export function subscribeRoom(roomId, cb) {
  return supabase
    .channel('room-' + roomId)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: T.rooms, filter: `id=eq.${roomId}` },
      (payload) => cb(payload.new)
    )
    .subscribe()
}

// Subscribe to roster + lock changes. cb is called on any change; the caller
// re-fetches the player list.
export function subscribePlayers(roomId, cb) {
  return supabase
    .channel('players-' + roomId)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: T.players, filter: `room_id=eq.${roomId}` },
      (payload) => cb(payload)
    )
    .subscribe()
}
