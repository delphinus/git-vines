import { readAll } from "https://deno.land/std@0.107.0/io/util.ts";
import { Semaphore } from "https://deno.land/x/semaphore@v1.1.0/mod.ts";

export class Git {
  private semaphore: Semaphore;
  private decoder = new TextDecoder();

  constructor(semaphore: number, private binary = "git") {
    this.semaphore = new Semaphore(semaphore);
  }

  open(...args: string[]): Promise<Deno.Reader & Deno.Closer> {
    return this.semaphore.use(() =>
      new Promise((resolve) =>
        resolve(
          Deno.run({ cmd: [this.binary, ...args], stdout: "piped" }).stdout,
        )
      )
    );
  }

  async run(...args: string[]): Promise<string> {
    const p = await this.open(...args);
    const output = await readAll(p);
    const out = this.decoder.decode(output);
    return out.replace(/\n$/, "");
  }
}
