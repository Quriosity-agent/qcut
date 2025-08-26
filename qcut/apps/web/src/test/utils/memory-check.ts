interface MemorySnapshot {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
  timestamp: number;
}

export function checkMemoryUsage(): MemorySnapshot | null {
  // TypeScript doesn't have performance.memory by default
  const perf = performance as any;
  
  if (perf.memory) {
    return {
      usedJSHeapSize: perf.memory.usedJSHeapSize,
      totalJSHeapSize: perf.memory.totalJSHeapSize,
      jsHeapSizeLimit: perf.memory.jsHeapSizeLimit,
      timestamp: Date.now(),
    };
  }
  
  return null;
}

export function formatMemoryUsage(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}

export class MemoryLeakDetector {
  private snapshots: MemorySnapshot[] = [];
  
  takeSnapshot() {
    const snapshot = checkMemoryUsage();
    if (snapshot) {
      this.snapshots.push(snapshot);
    }
  }
  
  detectLeak(threshold = 10): boolean {
    if (this.snapshots.length < 2) return false;
    
    const first = this.snapshots[0];
    const last = this.snapshots[this.snapshots.length - 1];
    const increaseMB = (last.usedJSHeapSize - first.usedJSHeapSize) / (1024 * 1024);
    
    return increaseMB > threshold;
  }
  
  reset() {
    this.snapshots = [];
  }
}