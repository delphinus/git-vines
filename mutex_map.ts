import { Mutex } from "https://deno.land/x/semaphore@v1.1.0/mod.ts";

export class MutexMap<K, V> {
  private mutex = new Mutex();
  private map = new Map<K, V>();

  get(k: K): Promise<V | undefined> {
    return this.mutex.use(() =>
      new Promise((resolve) => resolve(this.map.get(k)))
    );
  }

  set(k: K, v: V): Promise<void> {
    return this.mutex.use(() =>
      new Promise((resolve) => {
        this.map.set(k, v);
        resolve();
      })
    );
  }
}
