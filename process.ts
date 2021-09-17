export class Process {
  async run(): Promise<void> {
    console.log(await this.getRefs());
  }

  private async getRefs(): Promise<Map<string, string[]>> {
    const refs = new Map<string, string[]>();
    for (const ref of await this.git("show-ref")) {
      if (ref.length === 0) {
        continue;
      }
      const m = ref.match(/^(\S+)\s+(.*)$/);
      if (m) {
        const [_, sha, name] = m;
        const names = refs.get(sha) || [];
        names.push(name);
        refs.set(sha, names);
        if (/^refs\/tags\//.test(name)) {
          const subSha =
            (await this.git("log", "-1", "--pretty=format:%H", name))[0];
          const subNames = refs.get(subSha) || [];
          subNames.push(name);
          refs.set(subSha, subNames);
        }
      }
    }
    return refs;
  }

  private async git(...cmd: string[]): Promise<string[]> {
    const p = Deno.run({ cmd: ["git", "show-ref"], stdout: "piped" });
    await p.status();
    return new TextDecoder().decode(await p.output()).split(/\n/);
  }
}
