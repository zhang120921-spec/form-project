-- Remove all seeded demo users and bots, keeping admin, real users, and famous pro players.
-- Run this while the server is stopped.

PRAGMA foreign_keys = OFF;

-- Identify demo/bot user IDs to remove
CREATE TEMP TABLE demo_users AS
SELECT id FROM users
WHERE email LIKE '%@demo.golf' OR email LIKE '%@form.golf';

-- Remove attestations on rounds that involve demo/bot users
DELETE FROM attestations
WHERE round_id IN (
  SELECT DISTINCT round_id FROM round_participants
  WHERE player_id IN (SELECT id FROM demo_users)
);

-- Remove AI analysis on rounds that involve demo/bot users
DELETE FROM ai_analysis
WHERE round_id IN (
  SELECT DISTINCT round_id FROM round_participants
  WHERE player_id IN (SELECT id FROM demo_users)
);

-- Remove play invitations involving demo/bot users
DELETE FROM play_invitations
WHERE from_id IN (SELECT id FROM demo_users)
   OR to_id IN (SELECT id FROM demo_users);

-- Remove friendships involving demo/bot users
DELETE FROM friendships
WHERE user_id IN (SELECT id FROM demo_users)
   OR friend_id IN (SELECT id FROM demo_users);

-- Remove friend requests involving demo/bot users
DELETE FROM friend_requests
WHERE from_id IN (SELECT id FROM demo_users)
   OR to_id IN (SELECT id FROM demo_users);

-- Remove round participants for rounds that involve demo/bot users
DELETE FROM round_participants
WHERE round_id IN (
  SELECT DISTINCT round_id FROM round_participants
  WHERE player_id IN (SELECT id FROM demo_users)
);

-- Remove rounds that involved demo/bot users (no participants left)
DELETE FROM rounds
WHERE id NOT IN (SELECT round_id FROM round_participants);

-- Remove sessions and password resets for demo/bot users
DELETE FROM sessions WHERE user_id IN (SELECT id FROM demo_users);
DELETE FROM password_resets WHERE user_id IN (SELECT id FROM demo_users);

-- Finally remove demo/bot users themselves
DELETE FROM users WHERE id IN (SELECT id FROM demo_users);

DROP TABLE demo_users;

-- ── Second pass: clean up orphaned data from any deleted users ──

-- Delete participants of rounds logged by non-existent users
DELETE FROM round_participants
WHERE round_id IN (
  SELECT r.id FROM rounds r
  WHERE r.logged_by NOT IN (SELECT id FROM users)
);

-- Delete rounds logged by non-existent users
DELETE FROM rounds
WHERE logged_by NOT IN (SELECT id FROM users);

-- Delete orphaned friendships
DELETE FROM friendships
WHERE user_id NOT IN (SELECT id FROM users)
   OR friend_id NOT IN (SELECT id FROM users);

-- Delete orphaned friend requests
DELETE FROM friend_requests
WHERE from_id NOT IN (SELECT id FROM users)
   OR to_id NOT IN (SELECT id FROM users);

-- Delete orphaned attestations
DELETE FROM attestations
WHERE round_id NOT IN (SELECT id FROM rounds);

-- Delete orphaned AI analysis
DELETE FROM ai_analysis
WHERE round_id NOT IN (SELECT id FROM rounds);

-- Delete orphaned play invitations
DELETE FROM play_invitations
WHERE from_id NOT IN (SELECT id FROM users)
   OR to_id NOT IN (SELECT id FROM users);

-- Delete orphaned sessions
DELETE FROM sessions
WHERE user_id NOT IN (SELECT id FROM users);

PRAGMA foreign_keys = ON;
