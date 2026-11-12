import { Argument, Command } from "commander";
import type { IO } from "../context.js";
import { catalog } from "./catalog.js";

// rw completion bash|zsh|fish: a script that teaches your shell rw's
// commands and flags. Made from the command tree, so it's never out of date.
//
//   rw completion zsh > "${fpath[1]}/_rw"
//   rw completion bash > ~/.local/share/bash-completion/completions/rw
//   rw completion fish > ~/.config/fish/completions/rw.fish

interface Tree {
  /** Words that can come next after each command path ("" is the top). */
  next: Map<string, Set<string>>;
  /** Flags each full command takes. */
  flags: Map<string, Set<string>>;
}

function tree(program: Command): Tree {
  const next = new Map<string, Set<string>>();
  const flags = new Map<string, Set<string>>();
  const global = program.options.flatMap((option) => [option.long, option.short].filter(Boolean) as string[]);
  for (const entry of catalog(program)) {
    const words = entry.command.split(" ");
    words.forEach((word, i) => {
      const parent = words.slice(0, i).join(" ");
      if (!next.has(parent)) next.set(parent, new Set());
      next.get(parent)?.add(word);
    });
    const own = entry.options.flatMap((option) => option.flags.match(/--?[\w-]+/g) ?? []);
    flags.set(entry.command, new Set([...own, ...global, "--help"]));
  }
  return { next, flags };
}

function bash(t: Tree): string {
  const cases = [...t.next].map(([path, words]) => `    "${path}") words="${[...words].join(" ")}" ;;`);
  const flagCases = [...t.flags].map(([path, words]) => `    "${path}") flags="${[...words].join(" ")}" ;;`);
  return `# rw completion for bash. Load it with: source <(rw completion bash)
_rw() {
  local cur="\${COMP_WORDS[COMP_CWORD]}" path="" word words="" flags="" skip=""
  for word in "\${COMP_WORDS[@]:1:COMP_CWORD-1}"; do
    # The word after -P is a profile name, not a command.
    if [[ -n "$skip" ]]; then skip=""; continue; fi
    case "$word" in -P|--profile) skip=1 ;; -*) ;; *) path="\${path:+$path }$word" ;; esac
  done
  case "$path" in
${cases.join("\n")}
  esac
  case "$path" in
${flagCases.join("\n")}
  esac
  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W "$flags" -- "$cur") )
  else
    COMPREPLY=( $(compgen -W "$words" -- "$cur") )
  fi
}
complete -F _rw rw
`;
}

function zsh(t: Tree): string {
  return `#compdef rw
# rw completion for zsh. It uses the bash completion through bashcompinit.
autoload -U +X bashcompinit && bashcompinit
${bash(t)}`;
}

function fish(t: Tree): string {
  const lines = ["# rw completion for fish", "complete -c rw -f"];
  for (const [path, words] of t.next) {
    const depth = path ? path.split(" ").length : 0;
    const condition =
      depth === 0
        ? "__fish_use_subcommand"
        : `__fish_seen_subcommand_from ${path.split(" ").at(-1)}; and test (count (commandline -opc)) -eq ${depth + 1}`;
    lines.push(`complete -c rw -n '${condition}' -a '${[...words].join(" ")}'`);
  }
  return `${lines.join("\n")}\n`;
}

export function completionCommand(_io: () => IO, program: () => Command): Command {
  return new Command("completion")
    .description("Print a shell completion script")
    .addArgument(new Argument("<shell>", "Your shell").choices(["bash", "zsh", "fish"]))
    .action((shell: string) => {
      const t = tree(program());
      process.stdout.write(shell === "bash" ? bash(t) : shell === "zsh" ? zsh(t) : fish(t));
    });
}
