import { join, normalize } from "https://deno.land/std@0.107.0/path/mod.ts";
import { readAll } from "https://deno.land/std@0.107.0/io/util.ts";
import { readLines } from "https://deno.land/std@0.107.0/io/mod.ts";
import { exists } from "https://deno.land/std@0.107.0/fs/mod.ts";

export class Process {
  async run(): Promise<void> {
    console.log(await this.refs());
    console.log(await this.repoPath());
  }

  private async refs(): Promise<Map<string, string[]>> {
    const refs = new Map<string, string[]>();
    for await (const line of readLines(this.gitOpen("show-ref"))) {
      const m = line.match(/^(\S+)\s+(.*)$/);
      if (!m) {
        continue;
      }
      const [_, sha, name] = m;
      const names = refs.get(sha) || [];
      names.push(name);
      refs.set(sha, names);
      if (/^refs\/tags\//.test(name)) {
        const subSha = await this.git(
          "log",
          "-1",
          "--pretty=format:%H",
          name,
        );
        const subNames = refs.get(subSha) || [];
        subNames.push(name);
        refs.set(subSha, subNames);
      }
    }
    return refs;
  }

  private async repoPath(): Promise<string> {
    const top = await this.git("rev-parse", "--show-toplevel");
    const dotGit = join(top, ".git");
    if (!(await exists(dotGit))) {
      throw new Error(`.git not found: ${dotGit}`);
    }
    const st = await Deno.stat(dotGit);
    if (st.isDirectory) {
      return dotGit;
    } else if (st.isFile) {
      const fh = await Deno.open(dotGit);
      const line = new TextDecoder().decode(await readAll(fh));
      const m = line.match(/^gitdir:\s+([^\n]+)/);
      if (!m) {
        throw new Error(`invalid .git file: ${dotGit}`);
      }
      return normalize(join(dotGit, m[1]));
    }
    throw new Error("cannot detect repo_path");
  }

  private async git(...args: string[]): Promise<string> {
    const stdout = this.gitOpen(...args);
    const output = await readAll(this.gitOpen(...args));
    const out = new TextDecoder().decode(output);
    return out.replace(/\n$/, "");
  }

  private gitOpen(...args: string[]): Deno.Reader & Deno.Closer {
    return Deno.run({ cmd: ["git", ...args], stdout: "piped" }).stdout;
  }
}
