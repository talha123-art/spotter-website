/**
 * Lightweight imperative pub/sub so the 0-48h slider can drive the MapLibre
 * heatmap layer and animated truck markers inside requestAnimationFrame at 60fps
 * without re-rendering the React component tree on every scrub/play tick.
 */

type Listener = (hour: number) => void;

class HeatmapBridge {
  private currentHour = 0;
  private scheduled = false;
  private listeners = new Set<Listener>();

  getHour(): number {
    return this.currentHour;
  }

  getDiscreteHour(): number {
    return Math.round(this.currentHour);
  }

  setHour(hour: number): void {
    const clamped = Math.max(0, Math.min(48, hour));
    this.currentHour = clamped;
    if (this.scheduled) return;
    this.scheduled = true;
    window.requestAnimationFrame(() => {
      this.scheduled = false;
      for (const fn of this.listeners) {
        fn(this.currentHour);
      }
    });
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}

export const heatmapBridge = new HeatmapBridge();
