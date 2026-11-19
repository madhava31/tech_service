// The date a stock movement is recorded for. Every stock change is a row in inventory_movement whose created_at is
// "when it happened", so the stock ledger, the Stock In / Out report and "last stock in" all follow it.
//
//   no date, or today (India time)  -> null: the movement takes the current time
//   an earlier day                  -> that day at noon India time (06:30 UTC), as the entry has no real time of day
//   a future day, or a bad date     -> refused
import { todayIST } from './movementReport.js';

class MovementDateError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

export const EARLIEST_MOVEMENT_DATE = '2000-01-01';

/** The UTC timestamp text for created_at, or null for "now". Throws a 400 error for a bad or future date. */
export function movementTimestamp(value, today = todayIST()) {
  if (value === undefined || value === null || value === '') return null;
  const day = String(value).slice(0, 10);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
  if (!valid) throw new MovementDateError('Enter a valid date.');
  if (day > today) throw new MovementDateError('The date cannot be in the future.');
  if (day < EARLIEST_MOVEMENT_DATE) throw new MovementDateError('That date is too far in the past.');
  if (day === today) return null;
  return `${day} 06:30:00`;
}
