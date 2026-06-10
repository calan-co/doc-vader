declare module 'js-yaml' {
  export function load(value: string, options?: unknown): unknown;
  export function dump(value: unknown, options?: unknown): string;
  const defaultExport: {
    load: typeof load;
    dump: typeof dump;
  };
  export default defaultExport;
}
