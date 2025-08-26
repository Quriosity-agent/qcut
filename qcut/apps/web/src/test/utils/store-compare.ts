export function compareStores(before: any, after: any): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}

export function getStoreDifferences(before: any, after: any): string[] {
  const differences: string[] = [];
  
  const checkDiff = (obj1: any, obj2: any, path = '') => {
    for (const key in obj1) {
      const newPath = path ? `${path}.${key}` : key;
      if (JSON.stringify(obj1[key]) !== JSON.stringify(obj2[key])) {
        differences.push(newPath);
      }
    }
  };
  
  checkDiff(before, after);
  return differences;
}