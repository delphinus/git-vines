import { Process } from "./process.ts";
import { cac } from "https://unpkg.com/cac@6.7.3/mod.ts#^";

type Style = "Single" | "Double" | "Rounded" | "Bold";

const mapStyle = (s: number): Style => {
  const m = new Map<number, Style>([
    [1, "Single"],
    [2, "Double"],
    [10, "Rounded"],
    [15, "Bold"],
  ]);
  const style = m.get(s);
  if (style) {
    return style;
  }
  throw new Error(`unknown number: ${s}`);
};

export interface Options {
  svdepth: 2;
  status: boolean;
  style: Style;
  graphMarginLeft: number;
  graphMarginRight: number;
  graphSymbolCommit: string;
  graphSymbolMerge: string;
  graphSymbolOverpass: string;
  graphSymbolRoot: string;
  graphSymbolTip: string;
  help: boolean;
}

export function main() {
  const cli = cac("git-vines");
  cli.help();
  cli.option(
    "--svdepth <Subvine depth>",
    "Maximum length of merge subvines",
    { default: 2 },
  );
  cli.option("--status", "Show the working tree status near HEAD.", {
    default: true,
  });
  cli.option(
    "--style <Style>",
    `Select <Style> from following.
                                    1   Use single-line visuals.
                                    2   Use double-line visuals.
                                    10  Use specific rounded Unicode visuals for edges.
                                    15  Use single bold-line visuals.`,
    { default: 1 },
  );
  cli.option("--graph-margin-left <Margin>", "Left margin of commit graph", {
    default: 2,
  });
  cli.option("--graph-margin-right <Margin>", "Right margin of commit graph", {
    default: 2,
  });
  cli.option("--graph-symbol-commit <Symbol>", "Graph symbol of commit", {
    default: "●",
  });
  cli.option("--graph-symbol-merge <Symbol>", "Graph symbol of merge", {
    default: "◎",
  });
  cli.option("--graph-symbol-overpass <Symbol>", "Graph symbol of overpass", {
    default: "═",
  });
  cli.option("--graph-symbol-root <Symbol>", "Graph symbol of root", {
    default: "■",
  });
  cli.option("--graph-symbol-tip <Symbol>", "Graph symbol of tip", {
    default: "○",
  });
  cli.version("v0.0.1");
  const { options } = cli.parse();
  options.style = mapStyle(options.style);
  new Process(options as Options).run();
}
