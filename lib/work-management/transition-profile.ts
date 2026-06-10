import Ajv from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
import type {
  DimensionName,
  ScalarValue,
  StateVector,
  TransitionContract,
  TransitionSelector,
} from './state-transition-evaluator.js';

const PROFILE_PATH = 'transitionProfile';

interface SourceDimension {
  path: string;
  domain?: string;
  domainBy?: {
    dimension: DimensionName;
    cases: Record<ScalarValue, string>;
    requiredCases?: readonly ScalarValue[];
    extensionDomain?: string;
  };
  allowUnknown?: boolean;
}

interface LookupDerivedDimension {
  kind: 'lookup';
  from: readonly DimensionName[];
  table: string;
}

interface LookupTable {
  values: string;
  default?: ScalarValue;
  total?: boolean;
  map: Record<string, unknown>;
}

export interface TransitionProfile {
  version: string;
  sourceDimensions: Record<DimensionName, SourceDimension>;
  derivedDimensions: Record<DimensionName, LookupDerivedDimension>;
  lookupTables: Record<string, LookupTable>;
  transitions: TransitionContract;
}

interface CompiledEnum {
  values: readonly ScalarValue[];
  valueSet: ReadonlySet<ScalarValue>;
}

interface CompiledSourceDimension extends Omit<SourceDimension, 'domain' | 'domainBy'> {
  domain?: CompiledEnum;
  domainBy?: {
    dimension: DimensionName;
    cases: Record<ScalarValue, CompiledEnum>;
    extensionDomain?: CompiledEnum;
  };
}

interface CompiledLookupTable extends Omit<LookupTable, 'values'> {
  values: string;
  valueDomain: CompiledEnum;
}

export interface CompiledTransitionProfile {
  sourceDimensions: Record<DimensionName, CompiledSourceDimension>;
  derivedDimensions: Record<DimensionName, LookupDerivedDimension>;
  derivedDimensionOrder: readonly DimensionName[];
  lookupTables: Record<string, CompiledLookupTable>;
  transitions: TransitionContract;
}

export interface TransitionProfileDiagnostic {
  path: string;
  message: string;
}

export class TransitionProfileError extends Error {
  constructor(public readonly diagnostics: readonly TransitionProfileDiagnostic[]) {
    super(diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join('\n'));
    this.name = 'TransitionProfileError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeJsonPointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function resolveJsonPointer(document: unknown, pointer: string): unknown {
  if (!pointer.startsWith('#/')) {
    throw new Error(`Expected a JSON Pointer fragment, received '${pointer}'`);
  }

  return pointer
    .slice(2)
    .split('/')
    .map(decodeJsonPointerToken)
    .reduce<unknown>((current, token) => {
      if (!isRecord(current) || !(token in current)) {
        throw new Error(`JSON Pointer fragment '${pointer}' does not resolve`);
      }

      return current[token];
    }, document);
}

export interface SchemaRegistry {
  resolve: (reference: string) => unknown;
}

export function createSchemaRegistry(
  documents: readonly Record<string, unknown>[],
  defaultDocument?: Record<string, unknown>
): SchemaRegistry {
  const documentsById = new Map<string, Record<string, unknown>>();

  for (const document of documents) {
    if (typeof document.$id !== 'string') {
      continue;
    }

    const existing = documentsById.get(document.$id);
    if (existing && existing !== document) {
      throw new Error(`Duplicate schema id '${document.$id}'`);
    }

    documentsById.set(document.$id, document);
  }

  if (
    defaultDocument &&
    typeof defaultDocument.$id === 'string' &&
    !documentsById.has(defaultDocument.$id)
  ) {
    documentsById.set(defaultDocument.$id, defaultDocument);
  }

  return {
    resolve(reference: string): unknown {
      const fragmentIndex = reference.indexOf('#');
      if (fragmentIndex < 0) {
        throw new Error(`Schema reference '${reference}' must include a JSON Pointer fragment`);
      }

      const schemaId = reference.slice(0, fragmentIndex);
      const fragment = reference.slice(fragmentIndex);
      const document = schemaId ? documentsById.get(schemaId) : defaultDocument;
      if (!document) {
        throw new Error(`Schema reference '${reference}' targets unknown schema id '${schemaId}'`);
      }

      return resolveJsonPointer(document, fragment);
    },
  };
}

export function readSchemaEnum(registry: SchemaRegistry, reference: string): readonly string[] {
  const target = registry.resolve(reference);
  if (!isRecord(target) || !Array.isArray(target.enum)) {
    throw new Error(`Schema reference '${reference}' must resolve to a schema with an enum`);
  }

  if (!target.enum.every((value) => typeof value === 'string')) {
    throw new Error(`Schema reference '${reference}' must resolve to a string enum`);
  }

  const values = [...new Set(target.enum as string[])];
  if (values.length !== target.enum.length || values.length === 0) {
    throw new Error(
      `Schema reference '${reference}' must resolve to a non-empty enum with unique values`
    );
  }

  return values;
}

function readEnum(registry: SchemaRegistry, reference: string): CompiledEnum {
  const values = readSchemaEnum(registry, reference);
  return { values, valueSet: new Set(values) };
}

function formatShapeErrors(
  errors: ErrorObject[] | null | undefined
): TransitionProfileDiagnostic[] {
  return (errors ?? []).map((error) => ({
    path: `${PROFILE_PATH}${error.instancePath || '/'}`,
    message: error.message ?? 'invalid transition profile structure',
  }));
}

function addDiagnostic(
  diagnostics: TransitionProfileDiagnostic[],
  path: string,
  message: string
): void {
  diagnostics.push({ path: `${PROFILE_PATH}${path}`, message });
}

function compileSourceDimensions(
  registry: SchemaRegistry,
  profile: TransitionProfile,
  diagnostics: TransitionProfileDiagnostic[]
): Record<DimensionName, CompiledSourceDimension> {
  const compiled: Record<DimensionName, CompiledSourceDimension> = {};

  for (const [dimensionName, dimension] of Object.entries(profile.sourceDimensions)) {
    try {
      compiled[dimensionName] = {
        path: dimension.path,
        allowUnknown: dimension.allowUnknown,
        ...(dimension.domain ? { domain: readEnum(registry, dimension.domain) } : {}),
      };
    } catch (error) {
      addDiagnostic(
        diagnostics,
        `/sourceDimensions/${dimensionName}/domain`,
        (error as Error).message
      );
    }
  }

  for (const [dimensionName, dimension] of Object.entries(profile.sourceDimensions)) {
    if (!dimension.domainBy) {
      continue;
    }

    const dependency = compiled[dimension.domainBy.dimension];
    if (!dependency?.domain) {
      addDiagnostic(
        diagnostics,
        `/sourceDimensions/${dimensionName}/domainBy/dimension`,
        `must reference a source dimension with a direct enum domain`
      );
      continue;
    }

    const cases: Record<ScalarValue, CompiledEnum> = {};
    for (const [caseValue, pointer] of Object.entries(dimension.domainBy.cases)) {
      if (!dependency.domain.valueSet.has(caseValue)) {
        addDiagnostic(
          diagnostics,
          `/sourceDimensions/${dimensionName}/domainBy/cases/${caseValue}`,
          `unknown '${dimension.domainBy.dimension}' value '${caseValue}'`
        );
      }

      try {
        cases[caseValue] = readEnum(registry, pointer);
      } catch (error) {
        addDiagnostic(
          diagnostics,
          `/sourceDimensions/${dimensionName}/domainBy/cases/${caseValue}`,
          (error as Error).message
        );
      }
    }

    for (const dependencyValue of dependency.domain.values) {
      if (!cases[dependencyValue]) {
        addDiagnostic(
          diagnostics,
          `/sourceDimensions/${dimensionName}/domainBy/cases`,
          `missing '${dimension.domainBy.dimension}' case '${dependencyValue}'`
        );
      }
    }

    for (const requiredCase of dimension.domainBy.requiredCases ?? []) {
      if (!cases[requiredCase]) {
        addDiagnostic(
          diagnostics,
          `/sourceDimensions/${dimensionName}/domainBy/requiredCases`,
          `unknown '${dimension.domainBy.dimension}' case '${requiredCase}'`
        );
      }
    }

    compiled[dimensionName] = {
      path: dimension.path,
      allowUnknown: dimension.allowUnknown,
      domainBy: {
        dimension: dimension.domainBy.dimension,
        cases,
        ...(dimension.domainBy.extensionDomain
          ? {
              extensionDomain: (() => {
                try {
                  return readEnum(registry, dimension.domainBy!.extensionDomain!);
                } catch (error) {
                  addDiagnostic(
                    diagnostics,
                    `/sourceDimensions/${dimensionName}/domainBy/extensionDomain`,
                    (error as Error).message
                  );
                  return undefined;
                }
              })(),
            }
          : {}),
      },
    };
  }

  return compiled;
}

function compileLookupTables(
  registry: SchemaRegistry,
  profile: TransitionProfile,
  diagnostics: TransitionProfileDiagnostic[]
): Record<string, CompiledLookupTable> {
  const compiled: Record<string, CompiledLookupTable> = {};

  for (const [tableName, table] of Object.entries(profile.lookupTables)) {
    try {
      const valueDomain = readEnum(registry, table.values);
      if (table.default && !valueDomain.valueSet.has(table.default)) {
        addDiagnostic(
          diagnostics,
          `/lookupTables/${tableName}/default`,
          `unknown lookup value '${table.default}'`
        );
      }

      compiled[tableName] = { ...table, valueDomain };
    } catch (error) {
      addDiagnostic(diagnostics, `/lookupTables/${tableName}/values`, (error as Error).message);
    }
  }

  return compiled;
}

function getDimensionValues(
  dimensionName: DimensionName,
  assignments: Readonly<Record<DimensionName, ScalarValue>>,
  sourceDimensions: Readonly<Record<DimensionName, CompiledSourceDimension>>,
  derivedDimensions: Readonly<Record<DimensionName, LookupDerivedDimension>>,
  lookupTables: Readonly<Record<string, CompiledLookupTable>>
): readonly ScalarValue[] {
  const sourceDimension = sourceDimensions[dimensionName];
  if (sourceDimension?.domain) {
    return sourceDimension.domain.values;
  }

  if (sourceDimension?.domainBy) {
    const dependencyValue = assignments[sourceDimension.domainBy.dimension];
    if (dependencyValue) {
      const caseValues = sourceDimension.domainBy.cases[dependencyValue]?.values ?? [];
      const extensionValues = sourceDimension.domainBy.extensionDomain?.values ?? [];
      return [...new Set([...caseValues, ...extensionValues])];
    }

    return [
      ...new Set([
        ...Object.values(sourceDimension.domainBy.cases).flatMap((domain) => [...domain.values]),
        ...(sourceDimension.domainBy.extensionDomain?.values ?? []),
      ]),
    ];
  }

  const derivedDimension = derivedDimensions[dimensionName];
  const table = derivedDimension ? lookupTables[derivedDimension.table] : undefined;
  return table?.valueDomain.values ?? [];
}

function validateLookupNode(
  node: unknown,
  path: string,
  dimensions: readonly DimensionName[],
  depth: number,
  assignments: Readonly<Record<DimensionName, ScalarValue>>,
  table: CompiledLookupTable,
  sourceDimensions: Readonly<Record<DimensionName, CompiledSourceDimension>>,
  derivedDimensions: Readonly<Record<DimensionName, LookupDerivedDimension>>,
  lookupTables: Readonly<Record<string, CompiledLookupTable>>,
  diagnostics: TransitionProfileDiagnostic[]
): void {
  if (depth === dimensions.length) {
    if (typeof node !== 'string' || !table.valueDomain.valueSet.has(node)) {
      addDiagnostic(diagnostics, path, `must be one of [${table.valueDomain.values.join(', ')}]`);
    }
    return;
  }

  if (!isRecord(node)) {
    addDiagnostic(diagnostics, path, `must map '${dimensions[depth]}' values to nested entries`);
    return;
  }

  const dimensionName = dimensions[depth];
  const validValues = new Set(
    getDimensionValues(
      dimensionName,
      assignments,
      sourceDimensions,
      derivedDimensions,
      lookupTables
    )
  );

  for (const [key, value] of Object.entries(node)) {
    if (key !== '*' && !validValues.has(key)) {
      addDiagnostic(diagnostics, `${path}/${key}`, `unknown '${dimensionName}' value '${key}'`);
      continue;
    }

    validateLookupNode(
      value,
      `${path}/${key}`,
      dimensions,
      depth + 1,
      key === '*' ? assignments : { ...assignments, [dimensionName]: key },
      table,
      sourceDimensions,
      derivedDimensions,
      lookupTables,
      diagnostics
    );
  }
}

function resolveLookupValue(
  table: CompiledLookupTable,
  dimensions: readonly DimensionName[],
  state: StateVector
): ScalarValue | null {
  let node: unknown = table.map;
  for (const dimensionName of dimensions) {
    if (!isRecord(node)) {
      return table.default ?? null;
    }

    const value = state[dimensionName];
    node = (value === null ? undefined : node[value]) ?? node['*'];
  }

  return typeof node === 'string' ? node : (table.default ?? null);
}

function validateTotalLookup(
  dimension: LookupDerivedDimension,
  table: CompiledLookupTable,
  sourceDimensions: Readonly<Record<DimensionName, CompiledSourceDimension>>,
  derivedDimensions: Readonly<Record<DimensionName, LookupDerivedDimension>>,
  lookupTables: Readonly<Record<string, CompiledLookupTable>>,
  diagnostics: TransitionProfileDiagnostic[]
): void {
  if (!table.total) {
    return;
  }

  const visit = (depth: number, state: StateVector): void => {
    if (depth === dimension.from.length) {
      if (resolveLookupValue(table, dimension.from, state) === null) {
        addDiagnostic(
          diagnostics,
          `/lookupTables/${dimension.table}/map`,
          `missing total mapping for ${JSON.stringify(state)}`
        );
      }
      return;
    }

    const dimensionName = dimension.from[depth];
    const assignments = Object.fromEntries(
      Object.entries(state).filter((entry): entry is [string, string] => entry[1] !== null)
    );
    for (const value of getDimensionValues(
      dimensionName,
      assignments,
      sourceDimensions,
      derivedDimensions,
      lookupTables
    )) {
      visit(depth + 1, { ...state, [dimensionName]: value });
    }
  };

  visit(0, {});
}

function sortDerivedDimensions(
  profile: TransitionProfile,
  diagnostics: TransitionProfileDiagnostic[]
): DimensionName[] {
  const sourceDimensionNames = new Set(Object.keys(profile.sourceDimensions));
  const derivedDimensionNames = new Set(Object.keys(profile.derivedDimensions));
  const visited = new Set<DimensionName>();
  const visiting = new Set<DimensionName>();
  const ordered: DimensionName[] = [];

  const visit = (dimensionName: DimensionName): void => {
    if (visited.has(dimensionName)) {
      return;
    }

    if (visiting.has(dimensionName)) {
      addDiagnostic(
        diagnostics,
        `/derivedDimensions/${dimensionName}/from`,
        `derived dimension dependency cycle detected`
      );
      return;
    }

    const dimension = profile.derivedDimensions[dimensionName];
    if (!dimension) {
      return;
    }

    visiting.add(dimensionName);
    for (const dependencyName of dimension.from) {
      if (!sourceDimensionNames.has(dependencyName) && !derivedDimensionNames.has(dependencyName)) {
        addDiagnostic(
          diagnostics,
          `/derivedDimensions/${dimensionName}/from`,
          `unknown dimension '${dependencyName}'`
        );
      }

      if (derivedDimensionNames.has(dependencyName)) {
        visit(dependencyName);
      }
    }
    visiting.delete(dimensionName);
    visited.add(dimensionName);
    ordered.push(dimensionName);
  };

  for (const dimensionName of derivedDimensionNames) {
    if (sourceDimensionNames.has(dimensionName)) {
      addDiagnostic(
        diagnostics,
        `/derivedDimensions/${dimensionName}`,
        `must not replace a source dimension`
      );
    }
    visit(dimensionName);
  }

  return ordered;
}

function readSelectorValues(value: string | readonly string[]): readonly string[] {
  return typeof value === 'string' ? [value] : value;
}

function selectorAssignments(selector: TransitionSelector): Record<DimensionName, ScalarValue> {
  return Object.fromEntries(
    Object.entries(selector).flatMap(([dimensionName, value]) => {
      const values = readSelectorValues(value);
      return values.length === 1 && values[0] !== '*' ? [[dimensionName, values[0]]] : [];
    })
  );
}

function validateSelector(
  selector: TransitionSelector,
  path: string,
  profile: TransitionProfile,
  sourceDimensions: Readonly<Record<DimensionName, CompiledSourceDimension>>,
  lookupTables: Readonly<Record<string, CompiledLookupTable>>,
  diagnostics: TransitionProfileDiagnostic[]
): void {
  const knownDimensions = new Set([
    ...Object.keys(profile.sourceDimensions),
    ...Object.keys(profile.derivedDimensions),
  ]);
  const precedence = new Set(profile.transitions.precedence);
  const assignments = selectorAssignments(selector);

  for (const [dimensionName, value] of Object.entries(selector)) {
    if (!knownDimensions.has(dimensionName)) {
      addDiagnostic(
        diagnostics,
        `${path}/${dimensionName}`,
        `unknown dimension '${dimensionName}'`
      );
      continue;
    }

    if (!precedence.has(dimensionName)) {
      addDiagnostic(
        diagnostics,
        `${path}/${dimensionName}`,
        `dimension '${dimensionName}' is missing from transition precedence`
      );
    }

    const domain = new Set(
      getDimensionValues(
        dimensionName,
        assignments,
        sourceDimensions,
        profile.derivedDimensions,
        lookupTables
      )
    );
    for (const selectorValue of readSelectorValues(value)) {
      if (selectorValue !== '*' && !domain.has(selectorValue)) {
        addDiagnostic(
          diagnostics,
          `${path}/${dimensionName}`,
          `unknown '${dimensionName}' value '${selectorValue}'`
        );
      }
    }
  }
}

export function compileTransitionProfile(
  profileDocument: Record<string, unknown>,
  profileShapeSchema: Record<string, unknown>,
  schemaDocuments: readonly Record<string, unknown>[] = [profileDocument]
): CompiledTransitionProfile {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validateShape = ajv.compile(profileShapeSchema);
  if (!validateShape(profileDocument)) {
    throw new TransitionProfileError(formatShapeErrors(validateShape.errors));
  }

  const typedProfile = profileDocument as unknown as TransitionProfile;
  const diagnostics: TransitionProfileDiagnostic[] = [];
  let registry: SchemaRegistry;
  try {
    registry = createSchemaRegistry(schemaDocuments, profileDocument);
  } catch (error) {
    throw new TransitionProfileError([{ path: PROFILE_PATH, message: (error as Error).message }]);
  }

  const sourceDimensions = compileSourceDimensions(registry, typedProfile, diagnostics);
  const lookupTables = compileLookupTables(registry, typedProfile, diagnostics);
  const derivedDimensionOrder = sortDerivedDimensions(typedProfile, diagnostics);

  for (const [dimensionName, dimension] of Object.entries(typedProfile.derivedDimensions)) {
    const table = lookupTables[dimension.table];
    if (!table) {
      addDiagnostic(
        diagnostics,
        `/derivedDimensions/${dimensionName}/table`,
        `unknown lookup table '${dimension.table}'`
      );
      continue;
    }

    validateLookupNode(
      table.map,
      `/lookupTables/${dimension.table}/map`,
      dimension.from,
      0,
      {},
      table,
      sourceDimensions,
      typedProfile.derivedDimensions,
      lookupTables,
      diagnostics
    );
    validateTotalLookup(
      dimension,
      table,
      sourceDimensions,
      typedProfile.derivedDimensions,
      lookupTables,
      diagnostics
    );
  }

  const knownDimensions = new Set([
    ...Object.keys(typedProfile.sourceDimensions),
    ...Object.keys(typedProfile.derivedDimensions),
  ]);
  for (const [index, dimensionName] of typedProfile.transitions.precedence.entries()) {
    if (!knownDimensions.has(dimensionName)) {
      addDiagnostic(
        diagnostics,
        `/transitions/precedence/${index}`,
        `unknown dimension '${dimensionName}'`
      );
    }
  }

  for (const [index, rule] of typedProfile.transitions.rules.entries()) {
    validateSelector(
      rule.from,
      `/transitions/rules/${index}/from`,
      typedProfile,
      sourceDimensions,
      lookupTables,
      diagnostics
    );
    validateSelector(
      rule.to,
      `/transitions/rules/${index}/to`,
      typedProfile,
      sourceDimensions,
      lookupTables,
      diagnostics
    );
  }

  if (diagnostics.length > 0) {
    throw new TransitionProfileError(diagnostics);
  }

  return {
    sourceDimensions,
    derivedDimensions: typedProfile.derivedDimensions,
    derivedDimensionOrder,
    lookupTables,
    transitions: typedProfile.transitions,
  };
}

function readDocumentPointer(document: unknown, pointer: string): unknown {
  if (!pointer.startsWith('/')) {
    throw new Error(`Expected a document pointer, received '${pointer}'`);
  }

  return pointer
    .slice(1)
    .split('/')
    .map(decodeJsonPointerToken)
    .reduce<unknown>((current, token) => {
      if (!isRecord(current)) {
        return undefined;
      }

      return current[token];
    }, document);
}

export function resolveStateVector(
  profile: CompiledTransitionProfile,
  document: unknown
): StateVector {
  const state: StateVector = {};

  for (const [dimensionName, dimension] of Object.entries(profile.sourceDimensions)) {
    const value = readDocumentPointer(document, dimension.path);
    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw new Error(
        `Source dimension '${dimensionName}' at '${dimension.path}' must be a string`
      );
    }

    state[dimensionName] = value ?? null;
  }

  for (const [dimensionName, dimension] of Object.entries(profile.sourceDimensions)) {
    const value = state[dimensionName];
    if (value === null || dimension.allowUnknown) {
      continue;
    }

    const domain = dimension.domain
      ? dimension.domain
      : dimension.domainBy?.cases[state[dimension.domainBy.dimension] ?? ''];
    const inDomain = domain?.valueSet.has(value);
    const inExtension = dimension.domainBy?.extensionDomain?.valueSet.has(value) ?? false;
    if (!inDomain && !inExtension) {
      throw new Error(`Unknown '${dimensionName}' value '${value}'`);
    }
  }

  for (const dimensionName of profile.derivedDimensionOrder) {
    const dimension = profile.derivedDimensions[dimensionName];
    const table = profile.lookupTables[dimension.table];
    state[dimensionName] = resolveLookupValue(table, dimension.from, state);
  }

  return state;
}
