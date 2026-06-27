# looopy

```
                bröther may i                 

              +*=
              o+:==o#%%%%%*+=++#:
:             :o: +%@%%@@%o+:  *o
+:            *o===#+ +@#+:   +#*o=
=            o#**o     +==+oo++++=o#
           :%oo++*+   :##*:o**o++++%
         :++:      :   :  :++++++==%+
       =+:         o#+    :::: :=  o@%+
     =#@+         =::+=  :=:       #@@@%o
    o@%%%                         o@@%%@@%*
   :@@%%%:                       =%@%%%%%@@#o
   #oo#@%:                       o@@%%%%%@%=+*
   #   :                         =%@@%%%@@# :*
  *+    =+                        :#@@@@@@#::*
 =o   =*+                          :+#@@@@*::*
 *+   %+                             :o**= ::*
 +o  :%=                    ::       :+:   :=o
 +o   %=:::                 o+      :oo   :=+*
  o++#o=:==:               +*     :+o:   ::+#
     *o:===::              +*     #=  : :==+#
      **======= ::   ::    =#     %=:::::=:=#
       :o*============::=::=*o   *o::======+#
         o*o+==============:+*+++*=======++#=
          **#*o+==::========:====:===+o**o=
             : =ooooooooooooooooo+=*#o:
                              :**+==+*
                                :oo++#

               have some lööps                
```

**An opinionated runtime that makes autonomous [Claude Code](https://docs.anthropic.com/en/docs/claude-code) workflows accountable.**

Fire-and-forget background agents are easy to launch and hard to trust. You kick one off, close the laptop, and hours later you have… what? A process that may have finished, half-finished, or quietly done the wrong thing — with no record either way.

looopy closes that loop. Every workflow is dispatched as a background Claude Code run and *forced* to terminate into a recorded verdict: **did it succeed, why, how confident, and what did it do.** No silent exits. Each outcome lands in an append-only ledger you can review and — because every run is stamped with the workflow's version — measure for regressions over time.

> **looopy is the tool. Operator is the library it runs** — a directory of workflows on your machine (`~/Agents/Operator/` by default). looopy dispatches them; Operator holds them.

---

## Why

Three things every serious autonomous workflow needs that a bare `claude --bg` doesn't give you:

1. **A verdict, always.** A run that ends without saying what happened is a run you can't trust. looopy injects an enforcement layer at dispatch — an MCP report tool plus a Stop-hook gate — so a run *cannot* end without recording its outcome.
2. **A durable record.** Outcomes append to a per-workflow `runs.jsonl` ledger: status, reasoning, confidence, summary, parameters, and the config version the run executed under.
3. **Regression tracking.** Versioning is mandatory. Stamp a version on each workflow, bump it when you change one, and the ledger lets you compare how a new version performs against the old.

Enforcement is *injected*, never written into your workflow directory — your workflows stay yours. looopy is opinionated about the **envelope** (every run is accountable), not about what the work is.

## Install

```bash
npm install -g looopy
```

That puts `looopy` on your PATH. Or install from source:

```bash
git clone https://github.com/LiquidBuiltIt/looopy.git
cd looopy
npm install
npm run build
npm link        # puts `looopy` on your PATH
```

**Requirements:**

- Node ≥ 20
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) on your `PATH` — looopy shells out to `claude` to dispatch runs. It uses `--bg`, `--permission-mode auto`, and inline `--mcp-config` / `--settings`, so you need a build that supports those (Opus / Sonnet 4.6+).

## Quickstart

```bash
looopy init                 # scaffold the workflow-library home (~/Agents/Operator)
looopy new hello            # scaffold a workflow at <home>/hello
# edit hello/.looopy/config.json — set "skill" and a "version"
looopy validate hello       # check the config + wiring before running
looopy run hello --name=world "optional run note"   # dispatch in the background
looopy report hello         # review recorded outcomes
```

## How it works

A **workflow** is any directory under your library home that contains a `.looopy/config.json`. Discovery is filesystem-only — drop the file in and the directory is callable. There is no registry to keep in sync.

```jsonc
// <home>/hello/.looopy/config.json
{
  "skill": "my-skill",     // the skill the dispatched run invokes (required)
  "version": "0.1.0",      // stamped onto every run for regression tracking (required)
  "params": [              // typed inputs, passed as --key=value at dispatch
    { "name": "name", "required": true, "description": "who to greet" }
  ]
}
```

When you `run` a workflow, looopy:

1. Resolves the config, validates the parameters you passed, and composes a minimal prompt (`Invoke the <skill> skill. Params: …`).
2. Launches a background `claude --bg --permission-mode auto` with the workflow dir as cwd, and the enforcement layer injected: `--mcp-config` registers the `looopy_report` tool; `--settings` installs the Stop-hook gate.
3. The run does its work and reports a verdict via `looopy_report` (`{ status, reasoning, confidence, action_summary }`). The Stop-hook gate refuses to let the run end until it does — with a backstop that records a `failure` verdict if the agent never complies.
4. The outcome appends to `<workflow>/.looopy/runs.jsonl`.

Because enforcement is supplied fresh on every dispatch, a workflow physically cannot drift out of compliance — there's nothing on disk to forget or edit.

## Commands

| Command | What it does |
|---|---|
| `looopy init` | Scaffold the workflow-library home |
| `looopy new <name>` | Scaffold a new workflow |
| `looopy onboard <path>` | Scaffold + infer config for an existing workflow dir |
| `looopy validate <path>` | Validate a workflow's config and wiring |
| `looopy ls` | List discovered workflows |
| `looopy run <wf> [--key=value …] [note]` | Dispatch a workflow in the background |
| `looopy status [wf]` (alias `ps`) | List live looopy-spawned runs |
| `looopy logs <id>` | Print recent output of a run |
| `looopy stop <id>` | Stop a run |
| `looopy report [wf] [-n N]` | Review recorded run outcomes |

## Configuration

- **`OPERATOR_ROOT`** — override the workflow-library home (default `~/Agents/Operator`). Supports `~` expansion. The variable names the *library* (Operator), which is why it keeps that name.
- Auth tokens (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`) are stripped from a run's child environment unless a workflow explicitly declares it needs them — runs don't silently inherit your shell credentials.

## Status

Early and under active development. The core loop — dispatch, enforce, record, version — works and is covered by tests (`npm test`). Interfaces may still shift.

## License

MIT
