export function compareStores(before: any, after: any): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}

export function getStoreDifferences<T extends Record<string, unknown>>(
  before: T,
  after: T
): string[] {
  const diffs: string[] = [];

  const isObject = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === "object" && !Array.isArray(v);

  const isDate = (v: unknown): v is Date => v instanceof Date;

  const deepEqual = (a: unknown, b: unknown): boolean => {
    if (Object.is(a, b)) return true;
    if (isDate(a) && isDate(b)) return a.getTime() === b.getTime();
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!deepEqual(a[i], b[i])) return false;
      }
      return true;
    }
    if (isObject(a) && isObject(b)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) {
        if (
          !deepEqual(
            (a as Record<string, unknown>)[k],
            (b as Record<string, unknown>)[k]
          )
        ) {
          return false;
        }
      }
      return true;
    }
    return false;
  };

  const walk = (a: unknown, b: unknown, path: string) => {
    if (deepEqual(a, b)) return;

    // Arrays
    if (Array.isArray(a) && Array.isArray(b)) {
      const max = Math.max(a.length, b.length);
      for (let i = 0; i < max; i++) {
        const p = `${path}[${i}]`;
        walk(a[i], b[i], p);
      }
      return;
    }

    // Objects
    if (isObject(a) && isObject(b)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) {
        const p = path ? `${path}.${k}` : k;
        walk(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
          p
        );
      }
      return;
    }

    // Primitive or type mismatch difference
    diffs.push(path || "<root>");
  };

  walk(before, after, "");
  return diffs;
}
