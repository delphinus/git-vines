import { join, normalize } from "https://deno.land/std@0.107.0/path/mod.ts";
import { readAll } from "https://deno.land/std@0.107.0/io/util.ts";
import { readLines } from "https://deno.land/std@0.107.0/io/mod.ts";
import { exists } from "https://deno.land/std@0.107.0/fs/mod.ts";

export class Process {
  private statCache = new Map<string, Deno.FileInfo | null>();
  private prettyFmt = "format:%H\t%at\t%an\t%C(reset)%C(auto)%d%C(reset)\t%s";
  private subVineDepth = 2;

  async run(): Promise<void> {
    console.log(await this.refs());
    console.log(await this.status());

    for await (
      const line of this.getLineBlock(
        this.gitOpen(
          "log",
          "--date-order",
          `--pretty=format:<%H><%h><%P>${this.prettyFmt}`,
        ),
        this.subVineDepth,
      )
    ) {
      //
    }
  }

  private async *getLineBlock(
    fh: Deno.Reader,
    max: number,
  ): AsyncGenerator<string> {
    for await (const line of readLines(fh)) {
      console.log(max);
      yield line;
    }
  }

  private async status(): Promise<string> {
    const results: string[] = [];
    for await (const result of [this.dirty(), this.midFlow()]) {
      results.push(result);
    }
    return results.join(" ");
  }
  private async dirty(): Promise<string> {
    const dirty: string[] = [];
    for await (
      const result of [
        // hasChangeUnstaged
        { cmd: ["diff", "--shortstat"], char: "*" },
        // hasChangeStaged
        { cmd: ["diff", "--shortstat", "--cached"], char: "+" },
        // hasStash
        { cmd: ["stash", "list"], char: "$" },
        // hasUntracked
        { cmd: ["ls-files", "--others", "--exclude-standard"], char: "%" },
      ].map((c) => this.git(...c.cmd).then((v) => v.length > 0 ? c.char : ""))
    ) {
      dirty.push(result);
    }
    return dirty.join("");
  }

  private async midFlow(): Promise<string> {
    const repoPath = await this.repoPath();
    const isDir = (...names: string[]) => this.isDir(join(repoPath, ...names));
    const isFile = (...names: string[]) =>
      this.isFile(join(repoPath, ...names));
    if (await isDir("rebase-merge")) {
      if (await isFile("rebase-merge", "interactive")) {
        return "|REBASE-i";
      } else {
        return "|REBASE-m";
      }
    } else if (await isDir("rebase-apply")) {
      if (await isFile("rebase-apply", "rebasing")) {
        return "|REBASE";
      } else if (await isFile("rebase-apply", "applying")) {
        return "|AM";
      } else {
        return "|AM/REBASE";
      }
    } else if (await isFile("MERGE_HEAD")) {
      return "|MERGING";
    } else if (await isFile("CHERRY_PICK_HEAD")) {
      return "|CHERRY-PICKING";
    } else if (await isFile("REVERT_HEAD")) {
      return "|REVERTING";
    } else if (await isFile("BISECT_LOG")) {
      return "|BISECTING";
    }
    return "";
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
    if (await this.isDir(dotGit)) {
      return dotGit;
    } else if (await this.isFile(dotGit)) {
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
    const output = await readAll(this.gitOpen(...args));
    const out = new TextDecoder().decode(output);
    return out.replace(/\n$/, "");
  }

  private gitOpen(...args: string[]): Deno.Reader & Deno.Closer {
    return Deno.run({ cmd: ["git", ...args], stdout: "piped" }).stdout;
  }

  private async isDir(name: string): Promise<boolean> {
    const cached = this.statCache.get(name);
    if (cached) {
      return cached.isDirectory;
    }
    const st = await Deno.stat(name).catch(() => null);
    this.statCache.set(name, st);
    return st ? st.isDirectory : false;
  }

  private async isFile(name: string): Promise<boolean> {
    const cached = this.statCache.get(name);
    if (cached) {
      return cached.isFile;
    }
    const st = await Deno.stat(name).catch(() => null);
    this.statCache.set(name, st);
    return st ? st.isFile : false;
  }
}
