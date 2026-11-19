-- Migration 013 (optional): an index on the date of stock movements.
--
-- Run it by hand in the Supabase SQL Editor whenever convenient. The Stock In / Out report selects movements by date
-- range (created_at); this index keeps it fast as the movement history grows. The report works without it. Nothing
-- else changes: it only adds an index.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE INDEX IF NOT EXISTS idx_inventory_movement_created ON inventory_movement (created_at);

COMMIT;
