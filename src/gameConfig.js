export const ARENA_HALF_EXTENT = 64;
export const ARENA_FLOOR_SIZE = 176;
export const PLAYER_BOUNDS = ARENA_HALF_EXTENT - 1.5;
export const PLAYER_JUMP_SPEED = 10.5;
export const PLAYER_GRAVITY = 28;
export const PLAYER_MAX_HP = 100;
export const TEAM_IDS = ['blue', 'red'];
export const TEAM_SPAWNS = {
  blue: [
    [-34, -44],
    [-16, -42],
    [0, -40],
    [16, -42],
    [34, -44],
  ],
  red: [
    [-34, 44],
    [-16, 42],
    [0, 40],
    [16, 42],
    [34, 44],
  ],
};
