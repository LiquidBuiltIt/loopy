# looopy

Dispatch `~/Agents/Operator/` workflows as fire-and-forget background Claude
runs, with **enforced outcome reporting** — every run terminates into a
recorded `success`/`failure` verdict you can review from the CLI.

A workflow is any directory under your library home (`~/Agents/Operator/`,
override with `OPERATOR_ROOT`) that contains a `.looopy/config.json`. That
file is the only marker — drop one in and the directory becomes callable.
There is no separate registration step.

## Install

    npm install && npm run build
    npm link        # exposes `looopy` on PATH

Requires Claude Code with `--bg`, `--permission-mode auto`, inline
`--mcp-config`, and inline `--settings` (Opus/Sonnet 4.6+).

## Commands

    looopy init                       # scaffold the library home
    looopy new <name>                 # scaffold a new (empty) workflow
    looopy onboard <path>             # scaffold + infer config for an existing workflow dir
    looopy validate <path>            # check a workflow's config + skill wiring
    looopy run <path> [--k=v ...] "note"   # dispatch a workflow in the background
    looopy ls                         # list discovered workflows
    looopy status [path]              # list live looopy-spawned runs
    looopy logs <id>                  # tail a run's output
    looopy stop <id>                  # kill a run
    looopy report [workflow] [-n N]   # review recorded run outcomes

`mcp-serve` and `stop-gate` also exist but are **internal** — looopy injects
them into each `claude --bg` dispatch; you never call them by hand.

## `.looopy/config.json`

    {
      "skill": "job-hunter-orchestrator",
      "version": "1.0.0",
      "params": [
        { "name": "profile", "required": true,
          "description": "candidate profile under profiles/ to run for" },
        { "name": "target", "required": false,
          "description": "qualified leads to apply to this run (default 5)" }
      ]
    }

- `skill` — the skill the dispatched agent invokes.
- `version` — **required.** A free-form version string you bump when the
  workflow's behavior changes. It is stamped onto every run in `runs.jsonl`,
  so run outcomes split cleanly across versions for regression/perf tracking.
  A config without a version fails `validate` and will not `run`.
- `params[]` — each `{ name, required, description? }`. `description` is
  optional but is rendered into the dispatch prompt so the agent understands
  what each param is for.

`run` validates required params (hard error if missing), composes a minimal
prompt (`Invoke the <skill> skill. Params: k=v (description), …`), and launches
`claude --bg --permission-mode auto` with the workflow dir as cwd.

## Outcome reporting & enforcement

Claude Code tracks *lifecycle* (working/idle/blocked/done), not *outcome*. So
looopy adds an outcome layer, injected **inline at dispatch** — nothing is
written into the workflow dir:

- `--mcp-config` registers an `looopy_report` MCP tool. The agent must call
  it as its final action with `{ status, reasoning, confidence, action_summary }`.
- `--settings` installs a Stop hook (`stop-gate`) that blocks turn-end until
  `looopy_report` has been called, with a 3-bounce backstop that records a
  `failure` verdict if the agent never complies.

Verdicts append to `<workflow>/.looopy/runs.jsonl`. Review them with:

    looopy report                     # latest run per workflow
    looopy report <workflow>          # that workflow's history (tail)
    looopy report <workflow> -n 5     # last 5

Because enforcement is supplied fresh on every dispatch, a workflow physically
cannot drift out of compliance — there is nothing on disk to forget or edit.

## Onboarding a workflow

Discovery is filesystem-only, so onboarding is just producing a valid
`.looopy/config.json`. The CLI does the mechanical half; an agent (or a
human who reads the workflow) does the comprehension half.

    looopy onboard <path>

This creates the config skeleton, infers the `skill` from the workflow's
`.claude/skills/*/SKILL.md` frontmatter, infers param candidates from the
script's `// args: { … }` comment (a trailing `?` marks optional), and prints a
handoff block with the remaining work — verify the skill, confirm params, write
descriptions, then:

    looopy validate <path>

`validate` is the deterministic gate: config parses, `version` is present,
`skill` is non-empty, the named skill exists on disk, params are well-formed.
Descriptions are optional — validity is not the same as description completeness.
