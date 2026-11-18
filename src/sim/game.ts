import { BALANCE, TERRAIN } from './data';
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
import { Rng } from './rng';
import { makeRelations } from './systems/diplomacy';
import { runDiplomacy } from './systems/diplomacy';
import { runAI } from './ai/ai';
import { runCombat } from './systems/combat';
import { runVictory } from './systems/victory';
import { runCities } from './systems/cities';

export interface PlayerSetup {
  name: string;
  color: string;
  isAI: boolean;
}

export interface GameSetup {
  seed: number;
  players: PlayerSetup[];
  /** Key of BALANCE.mapSizes (default: the balance map size). */
  mapSize?: string;
}

/** Land share outside this range is rerolled (deterministically) for playability. */
const MIN_LAND = 0.35;
const MAX_LAND = 0.75;

/** The fixed seed used by the test map. */
export const TEST_MAP_SEED = 20261118;

export function createGame(setup: GameSetup): GameState {
  const { width, height } = setup.mapSize ? BALANCE.mapSizes[setup.mapSize] : BALANCE.map;
  let seed = setup.seed;
  let tiles = generateMap(seed, { width, height });
  for (let tries = 0; tries < 20; tries++) {
    const land = tiles.filter((t) => TERRAIN[t.terrain].land).length / tiles.length;
    if (land >= MIN_LAND && land <= MAX_LAND) break;
    seed = (seed + 7919) | 0;
    tiles = generateMap(seed, { width, height });
  }
  const personality = new Rng(seed ^ 0x2545f491);
  return {
    seed,
    rngState: seed ^ 0x5bd1e995,
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
      ai: p.isAI
        ? { aggression: personality.next(), openness: personality.next(), expansion: personality.next() }
        : null,
      eliminated: false,
    })),
    villagers: [],
    buildings: [],
    nextEntityId: 1,
    events: [],
    mapVersion: 0,
    relations: makeRelations(setup.players.length),
    combatTiles: [],
    result: null,
  };
}

/** Apply commands without advancing time (used while paused). */
export function applyCommands(state: GameState, commands: Command[]): Array<string | null> {
  return commands.map((c) => applyCommand(state, c));
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
  runCombat(state);
  updateTerritory(state);
  runFood(state);
  runPopulation(state);
  runResearch(state);
  runLoyalty(state);
  runDiplomacy(state);
  runCities(state);
  runAI(state);
  runVictory(state);
  updateTerritory(state);
  updateVision(state);
  return results;
}
