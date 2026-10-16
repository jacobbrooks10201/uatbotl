// Public engine surface. The UI and any future network layer only talk to this.

import { AGE_1200BC } from '../data/age1200bc';
import { registerAge } from './rules';

registerAge(AGE_1200BC);

export const DEFAULT_AGE = AGE_1200BC.id;

export * from './types';
export { actionLabel, applyInput, applyInputMut, checkOptions, decider, IllegalInput, newGame, newScenario, parseNotation, positionKey, specOf } from './engine';
export type { ParsedGame, Scenario } from './engine';
export { formatNotation, notationRounds, resultText, type NoteTurn } from './notation';
export { commandKey, enumerateAction, legalOptions } from './options';
export {
  actionsOf,
  budgetFor,
  buildablesFor,
  computeBudget,
  controlledGates,
  describePiece,
  effectivePassives,
  findRole,
  giftedTraits,
  hasEffectiveTrait,
  resourceInstances,
  rulesFor,
  scopeAllows,
  unitDef,
  unitsOf,
  type Buildable,
  type Rules,
} from './rules';
