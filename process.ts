export class Process {
  async run(): Promise<void> {
    await Deno.run({ cmd: ["echo", "Hello, World!"] }).status();
  }
}
