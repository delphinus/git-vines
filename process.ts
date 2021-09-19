import { join, normalize } from "https://deno.land/std@0.107.0/path/mod.ts";
import { readAll } from "https://deno.land/std@0.107.0/io/util.ts";
import { readLines } from "https://deno.land/std@0.107.0/io/mod.ts";
import { exists } from "https://deno.land/std@0.107.0/fs/mod.ts";
import * as colors from "https://deno.land/std@0.107.0/fmt/colors.ts";
import { printf } from "https://deno.land/std@0.107.0/fmt/printf.ts";
import { Options } from "./main.ts";
import { MutexMap } from "./mutex_map.ts";

interface Commit {
  author: string;
  autoRefs: string;
  hash: string;
  miniSha: string;
  msg: string;
  nextSha: string[];
  parents: string[];
  sha: string;
  time: string;
}

const Color = {
  default: colors.white,
  tree: colors.cyan,
  hash: colors.magenta,
  date: colors.blue,
  author: colors.yellow,
  tag: (v: string) => colors.bold(colors.magenta(v)),
};

interface Stat {
  refs: MutexMap<string, string[]>;
  hashWidth: number;
  status?: string;
}

export class Process {
  private _repoPath: string | undefined = undefined;
  private statCache = new MutexMap<string, Deno.FileInfo | null>();
  private prettyFmt = "%H\t%at\t%an\t%C(reset)%C(auto)%d%C(reset)\t%s";
  private subVineDepth = 2;

  constructor(private opts: Options) {}

  async run(): Promise<void> {
    const vines: string[] = [];
    const { refs, hashWidth, status } = await this.stat();
    for await (
      const c of this.getLineBlock(
        this.gitOpen(
          "log",
          "--date-order",
          `--pretty=format:<%H><%h><%P>${this.prettyFmt}`,
          "--color",
        ),
        this.subVineDepth,
      )
    ) {
      this.vineBranch(vines, c.sha);
      printf(
        Color.hash(`%-${hashWidth}.${hashWidth}s `) + Color.date("%-16s%2s"),
        c.hash,
        c.time,
        "",
      );
      const ra = this.vineCommit(vines, c.sha, c.parents);
      // TODO
      const ref = await refs.get(c.sha);
      if (ref) {
        let modified = c.autoRefs;
        if (status && ref.some((r) => r === "HEAD")) {
          modified = modified.replace(/(?<=[^\/]HEAD)/, status);
        }
        if (ref.some((r) => /^refs\/tags\//.test(r))) {
          // TODO
          modified = modified.replace(
            /\x1b\[\d;\d\dm(tag: \S+)/g,
            Color.tag("$1"),
          );
        }
        printf("%s %s\n", modified, c.msg);
      } else {
        printf("%s %s\n", c.autoRefs, c.msg);
      }
      // TODO
    }
  }

  /**
   * Draws the branching vine matrix between a commit K and K^ (@rev).
   *
   * @param {string[]} vines - column array containing the expected parent IDs
   * @param {string} sha - commit ID
   */
  private vineBranch(vines: string[], sha: string) {
    //
  }

  private vineCommit(vines: string[], sha: string, parents: string[]) {
  }

  /** *
   * A: branch to right (TODO: left?)
   * B: branch to right
   * C: commit
   * M: merge commit
   * D: (TODO: ?)
   * e: merge visual left (╔)
   * f: merge visual center (╦)
   * g: merge visual right (╗)
   * I: straight line (║)
   * K: branch visual split (╬)
   * m: single line (─)
   * O: overpass (≡)
   * r: root (╙)
   * t: tip (╓)
   * x: branch visual left (╚)
   * y: branch visual center (╩)
   * z: branch visual right (╝)
   * *: filler
   */
  private visXfrm(source: string, spc?: string): void {
    // TODO: Is spc is needed?
  }

  private async stat(): Promise<Stat> {
    const [refs, hashWidth, status] = await Promise.all([
      this.refs(),
      this.git("rev-parse", "--short", "HEAD").then((v) => v.length),
      new Promise<string | undefined>((resolve) =>
        resolve(this.opts.status ? this.status() : undefined)
      ),
    ]);
    return { refs, hashWidth, status };
  }

  private async *getLineBlock(
    fh: Deno.Reader,
    max: number,
  ): AsyncGenerator<Commit> {
    const reader = readLines(fh);
    const lines: string[] = [];
    while (true) {
      while (lines.length < max) {
        const res = await reader.next();
        if (res.done) {
          break;
        }
        lines.push(res.value);
      }
      const line = lines.shift();
      if (!line) {
        break;
      }
      const m = line.match(/^<(.*?)><(.*?)><(.*?)>(.*)/s);
      if (!m) {
        break;
      }
      const [_, sha, miniSha, allParents, allMsg] = m;
      const [hash, timeStr, author, autoRefs, msg] = allMsg.split(/\t/, 5);
      yield {
        author,
        autoRefs,
        hash,
        miniSha,
        msg,
        nextSha: lines.slice(0, max - 2).map((line) =>
          line.replace(/^<(.*?)>/, RegExp.$1)
        ),
        parents: allParents.split(" "),
        sha,
        time: this.formatTime(parseInt(timeStr, 10) * 1000),
      };
    }
  }

  private formatTime(time: number) {
    const d = new Date(time);
    return `${d.getFullYear()}-${d.getMonth() +
      1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`;
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

  private async refs(): Promise<MutexMap<string, string[]>> {
    const refs = new MutexMap<string, string[]>();
    await Promise.all([this.refsAll(refs), this.refsHead(refs)]);
    return refs;
  }

  private async refsAll(refs: MutexMap<string, string[]>): Promise<void> {
    const setTags: Promise<void>[] = [];
    for await (const line of readLines(this.gitOpen("show-ref"))) {
      const m = line.match(/^(\S+)\s+(.*)$/);
      if (!m) {
        continue;
      }
      const [_, sha, name] = m;
      const names = await refs.get(sha) || [];
      names.push(name);
      await refs.set(sha, names);
      if (/^refs\/tags\//.test(name)) {
        setTags.push(
          this.git(
            "log",
            "-1",
            "--pretty=format:%H",
            name,
          ).then((subSha) =>
            refs.get(subSha).then((names) => ({ subSha, names }))
          )
            .then(
              ({ subSha, names }) => {
                const subNames = names || [];
                subNames.push(name);
                return refs.set(subSha, subNames);
              },
            ),
        );
      }
    }
    await Promise.all(setTags);
  }

  private async refsHead(refs: MutexMap<string, string[]>): Promise<void> {
    const showRebase = true; // TODO
    let hasRebase = false;
    if (showRebase) {
      const repoPath = await this.repoPath();
      if (
        await this.isFile(join(repoPath, "rebase-merge", "git-rebase-todo"))
      ) {
        hasRebase = true;
        // TODO
      }
    }
    const head = await this.git("rev-parse", "HEAD");
    const v = await refs.get(head) || [];
    if (hasRebase) {
      v.unshift("rebase/new");
    }
    v.unshift("HEAD");
    return refs.set(head, v);
  }

  private async repoPath(): Promise<string> {
    if (this._repoPath) {
      return this._repoPath;
    }
    const top = await this.git("rev-parse", "--show-toplevel");
    const dotGit = join(top, ".git");
    if (!(await exists(dotGit))) {
      throw new Error(`.git not found: ${dotGit}`);
    }
    if (await this.isDir(dotGit)) {
      return this._repoPath = dotGit;
    } else if (await this.isFile(dotGit)) {
      const fh = await Deno.open(dotGit);
      const line = new TextDecoder().decode(await readAll(fh));
      const m = line.match(/^gitdir:\s+([^\n]+)/);
      if (!m) {
        throw new Error(`invalid .git file: ${dotGit}`);
      }
      return this._repoPath = normalize(join(dotGit, m[1]));
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
    const cached = await this.statCache.get(name);
    if (cached) {
      return cached.isDirectory;
    }
    const st = await Deno.stat(name).catch(() => null);
    this.statCache.set(name, st);
    return st ? st.isDirectory : false;
  }

  private async isFile(name: string): Promise<boolean> {
    const cached = await this.statCache.get(name);
    if (cached) {
      return cached.isFile;
    }
    const st = await Deno.stat(name).catch(() => null);
    this.statCache.set(name, st);
    return st ? st.isFile : false;
  }
}
