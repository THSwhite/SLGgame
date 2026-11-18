import { BALANCE } from './data';
import { applyCommand, type Command } from './commands';
import { generateMap } from './mapgen';
import { runFood } from './systems/food';
import { runJobs } from './systems/jobs';
import { runPopulation } from './systems/population';
import { runLoyalty } from './systems/loyalty';
import { runResearch } from './systems/research';
import { updateTerritory } from './systems/territory';
import { updateVision } from './systems/vision';
import { Knowledge, type GameState } from './types';

export interface PlayerSetup {
  name: string;
  color: string;
  isAI: boolean;
}

export interface GameSetup {
  seed: number;
  players: PlayerSetup[];
}

/** The fixed seed used by the test map. */
export const TEST_MAP_SEED = 20261118;

export function createGame(setup: GameSetup): GameState {
  const { width, height } = BALANCE.map;
  const tiles = generateMap(setup.seed, { width, height });
  return {
    seed: setup.seed,
    rngState: setup.seed ^ 0x5bd1e995,
    tick: 0,
    phase: 'choosingStart',
    width,
    height,
    tiles,
    players: setup.players.map((p, id) => ({
      id,
      name: p.name,
      color: p.color,
      isAI: p.isAI,
      startTile: -1,
      stock: { ...BALANCE.startingStock },
      knowledge: new Array(tiles.length).fill(Knowledge.Unknown),
      visible: new Array(tiles.length).fill(0),
      atWar: false,
      management: {
        popIntervalSeconds: BALANCE.population.defaultIntervalSeconds,
        popEnabled: true,
        foodProtection: true,
      },
      popProgress: 0,
      researched: [],
      policies: [],
      currentResearch: null,
      researchPoints: 0,
    })),
    villagers: [],
    buildings: [],
    nextEntityId: 1,
    events: [],
    mapVersion: 0,
  };
}

/**
 * Advance the simulation by exactly one tick. Commands are applied first, in
 * the given order. Same state + same commands => same result (lockstep-safe).
 * Returns the error message for each command (null when it was applied).
 */
export function stepGame(state: GameState, commands: Command[] = []): Array<string | null> {
  const results = commands.map((c) => applyCommand(state, c));
  if (state.phase !== 'playing') return results;
  state.tick++;
  runJobs(state);
  updateTerritory(state);
  runFood(state);
  runPopulation(state);
  runResearch(state);
  runLoyalty(state);
  updateVision(state);
  return results;
}
