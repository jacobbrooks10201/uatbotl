// Public engine surface. The UI and any future network layer only talk to this.

import { AGE_1200BC } from '../data/age1200bc';
import { registerAge } from './rules';

registerAge(AGE_1200BC);

export const DEFAULT_AGE = AGE_1200BC.id;

export * from './types';
export { actionLabel, applyInput, applyInputMut, decider, IllegalInput, newGame, newScenario, positionKey, specOf } from './engine';
export type { Scenario } from './engine';
export { commandKey, enumerateAction, legalOptions } from './options';
export {
  budgetFor,
  computeBudget,
  controlledGates,
  describePiece,
  effectivePassives,
  findRole,
  rulesFor,
  unitDef,
  unitsOf,
  type Rules,
} from './rules';
