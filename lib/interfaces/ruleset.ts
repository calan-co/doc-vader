// Shared interfaces for all ruleset operations

export interface Classifier<TInput, TOutput> {
  classify(input: TInput): TOutput;
}

export interface Linter<TInput, TOutput> {
  lint(input: TInput): TOutput;
}

export interface Checker<TInput, TOutput> {
  check(input: TInput): TOutput;
}

export interface Fixer<TInput, TOutput> {
  fix(input: TInput): Promise<TOutput>;
}
