import { join, normalize } from "https://deno.land/std@0.107.0/path/mod.ts";
import { readAll } from "https://deno.land/std@0.107.0/io/util.ts";
import { readLines } from "https://deno.land/std@0.107.0/io/mod.ts";
import { exists } from "https://deno.land/std@0.107.0/fs/mod.ts";

export class Process {
  private statCache = new Map<string, Deno.FileInfo | null>();

  async run(): Promise<void> {
    console.log(await this.refs());
    console.log(await this.status());
  }

  private async status(): Promise<string> {
    const dirtyChars: string[] = [];
    const hasChangeUnstaged =
      (await this.git("diff", "--shortstat")).length > 0;
    if (hasChangeUnstaged) {
      dirtyChars.push("*");
    }
    const hasChangeStaged =
      (await this.git("diff", "--shortstat", "--cached")).length > 0;
    if (hasChangeStaged) {
      dirtyChars.push("+");
    }
    const hasStash = (await this.git("stash", "list")).length > 0;
    if (hasStash) {
      dirtyChars.push("$");
    }
    const hasUntracked =
      (await this.git("ls-files", "--others", "--exclude-standard")).length > 0;
    if (hasUntracked) {
      dirtyChars.push("%");
    }

    const repoPath = await this.repoPath();
    const isDir = (...names: string[]) => this.isDir(join(repoPath, ...names));
    const isFile = (...names: string[]) =>
      this.isFile(join(repoPath, ...names));
    const midFlow = (await isDir("rebase-merge"))
      ? (await isFile("rebase-merge", "interactive")) ? "|REBASE-i" : "REBASE-m"
      : (await isDir("rebase-apply"))
      ? (await isFile("rebase-apply", "rebasing"))
        ? "|REBASE"
        : (await isFile("rebase-apply", "applying"))
        ? "|AM"
        : "|AM/REBASE"
      : (await isFile("MERGE_HEAD"))
      ? "|MERGING"
      : (await isFile("CHERRY_PICK_HEAD"))
      ? "|CHERRY-PICKING"
      : (await isFile("REVERT_HEAD"))
      ? "|REVERTING"
      : (await isFile("BISECT_LOG"))
      ? "|BISECTING"
      : "";

    return [dirtyChars.join(""), midFlow].join(" ");
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
