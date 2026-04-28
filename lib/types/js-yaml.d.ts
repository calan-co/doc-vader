declare module 'js-yaml' {
  export function dump(value: unknown, options?: unknown): string;
  const defaultExport: {
    dump: typeof dump;
  };
  export default defaultExport;
}
