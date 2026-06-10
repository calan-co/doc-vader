export type DimensionName = string;
export type ScalarValue = string;
export type StateVector = Record<DimensionName, ScalarValue | null>;
export type SelectorValue = ScalarValue | readonly ScalarValue[];
export type TransitionSelector = Record<DimensionName, SelectorValue>;

export interface TransitionRule {
  id: string;
  from: TransitionSelector;
  to: TransitionSelector;
  decision: 'allow';
  note?: string;
}

export interface TransitionContract {
  precedence: readonly DimensionName[];
  rules: readonly TransitionRule[];
}

export interface TransitionEvaluation {
  allowed: boolean;
  matchedRuleId: string | null;
}

function stateVectorsEqual(left: StateVector, right: StateVector): boolean {
  const dimensions = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...dimensions].every(
    (dimension) => (left[dimension] ?? null) === (right[dimension] ?? null)
  );
}

function selectorValueMatches(
  selectorValue: SelectorValue,
  actualValue: ScalarValue | null
): boolean {
  const acceptedValues = Array.isArray(selectorValue) ? selectorValue : [selectorValue];
  return (
    acceptedValues.includes('*') || (actualValue !== null && acceptedValues.includes(actualValue))
  );
}

function selectorMatches(selector: TransitionSelector, state: StateVector): boolean {
  return Object.entries(selector).every(([dimension, selectorValue]) =>
    selectorValueMatches(selectorValue, state[dimension] ?? null)
  );
}

function selectorHasSpecificValue(selector: TransitionSelector, dimension: DimensionName): boolean {
  const selectorValue = selector[dimension];
  if (!selectorValue) {
    return false;
  }

  const acceptedValues = Array.isArray(selectorValue) ? selectorValue : [selectorValue];
  return acceptedValues.some((value) => value !== '*');
}

function compareRulePrecedence(
  left: { rule: TransitionRule; index: number },
  right: { rule: TransitionRule; index: number },
  precedence: readonly DimensionName[]
): number {
  for (const dimension of precedence) {
    const leftSpecificity =
      Number(selectorHasSpecificValue(left.rule.from, dimension)) +
      Number(selectorHasSpecificValue(left.rule.to, dimension));
    const rightSpecificity =
      Number(selectorHasSpecificValue(right.rule.from, dimension)) +
      Number(selectorHasSpecificValue(right.rule.to, dimension));

    if (leftSpecificity !== rightSpecificity) {
      return rightSpecificity - leftSpecificity;
    }
  }

  return left.index - right.index;
}

export function evaluateTransition(
  previous: StateVector,
  current: StateVector,
  contract: TransitionContract
): TransitionEvaluation {
  if (stateVectorsEqual(previous, current)) {
    return { allowed: true, matchedRuleId: null };
  }

  const candidates = contract.rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => selectorMatches(rule.from, previous) && selectorMatches(rule.to, current))
    .sort((left, right) => compareRulePrecedence(left, right, contract.precedence));

  if (candidates.length === 0) {
    return { allowed: false, matchedRuleId: null };
  }

  return { allowed: true, matchedRuleId: candidates[0].rule.id };
}
