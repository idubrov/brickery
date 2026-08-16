// Brick data model: standard cryptographic UUIDs, direction vectors, and
// (de)serialization with safe defaults. (spec §6 / §4.7)

import { COLORS, COLOR_LIST, DIR } from './Constants.js';

let brickSeq = 0;

function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  brickSeq += 1;
  return `brick-${Date.now().toString(36)}-${brickSeq}`;
}

const VALID_DIRECTIONS = new Set([DIR.NONE, DIR.EAST, DIR.WEST, DIR.SOUTH, DIR.NORTH]);
const VALID_COLORS = new Set(COLOR_LIST);

export class Brick {
  constructor({ id, color, direction } = {}) {
    this.id = typeof id === 'string' && id.length > 0 ? id : newId();
    this.color = VALID_COLORS.has(color) ? color : COLORS.crimson;
    this.direction = VALID_DIRECTIONS.has(direction) ? direction : DIR.NONE;
  }

  get isMoving() {
    return this.direction !== DIR.NONE;
  }

  toJSON() {
    return { id: this.id, color: this.color, direction: this.direction };
  }

  // Defensive deserialization: invalid / null payloads yield a valid default
  // brick rather than throwing (spec §4.7).
  static fromJSON(data) {
    if (!data || typeof data !== 'object') {
      return new Brick({});
    }
    return new Brick({
      id: typeof data.id === 'string' ? data.id : undefined,
      color: data.color,
      direction: data.direction,
    });
  }
}
