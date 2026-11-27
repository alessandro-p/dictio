import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// These types mirror review-schema.json, which the agent's answer is validated
// against. Change one, change the other.

type Axis = "standards" | "spec";

/** One problem the reviewer found. */
export type Finding = {
  /** The verdict section it belongs to. */
  axis: Axis;
  /** The problem in a few words, plain text. */
  title: string;
  /** The file, relative to the repository root. */
  path: string;
  /** The line in the file after the change; posted inline when it's in the diff. */
  line: number;
  /** Markdown: the rule or ticket line it breaks, what is wrong, what to do. */
  body: string;
};

/** The agent's whole answer. */
export type ReviewOutput = {
  /** The Standards axis in one or two sentences. */
  standards: string;
  /** The Spec axis in one or two sentences, or why there is no spec. */
  spec: string;
  /** Every finding from both axes. None on an axis means it passes. */
  findings: Finding[];
  /** What the reviewer wanted to fail the change for, with no standard to cite. */
  missingRules: string[];
};

// GitHub rejects a whole review if one inline comment is outside the diff, so
// only lines inside a hunk, on the new side, are commentable.
export const commentableLines = (diff: string): Map<string, Set<number>> => {
  const files = new Map<string, Set<number>>();
  let inHeader = false;
  let lines: Set<number> | undefined;
  let next = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      inHeader = true;
      lines = undefined;
      continue;
    }
    if (inHeader) {
      if (line.startsWith("+++ b/")) {
        lines = new Set();
        files.set(line.slice("+++ b/".length), lines);
      }
      if (!line.startsWith("@@")) continue;
      inHeader = false;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      next = Number(hunk[1]);
      continue;
    }
    if (lines && (line.startsWith("+") || line.startsWith(" "))) {
      lines.add(next);
      next++;
    }
  }

  return files;
};

const HEADINGS: Record<Axis, string> = { standards: "Standards", spec: "Spec" };

const indent = (text: string): string =>
  text
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");

const listed = (finding: Finding, inline: boolean): string => {
  const head = `- **${finding.title}**, at \`${finding.path}:${finding.line}\``;
  return inline ? head : `${head}\n\n${indent(finding.body)}`;
};

export const renderReview = (
  output: ReviewOutput,
  commentable: Map<string, Set<number>>,
  runUrl: string,
) => {
  const isInline = ({ path, line }: Finding) =>
    commentable.get(path)?.has(line) ?? false;

  const section = (axis: Axis, summary: string): string => {
    const findings = output.findings.filter((finding) => finding.axis === axis);
    const verdict = findings.length === 0 ? "PASS" : "CHANGES REQUESTED";
    const list = findings
      .map((finding) => listed(finding, isInline(finding)))
      .join("\n");
    return [`## ${HEADINGS[axis]}: ${verdict}`, summary, list]
      .filter(Boolean)
      .join("\n\n");
  };

  const rules =
    output.missingRules.length === 0
      ? "None."
      : output.missingRules.map((rule) => `- ${rule}`).join("\n");

  const body = [
    section("standards", output.standards),
    section("spec", output.spec),
    "## Rules this review wanted and could not find",
    rules,
    "---",
    `Reviewed by the review workflow ([logs](${runUrl})). It saw the diff, the coding standards and the ticket, and nothing else.`,
  ].join("\n\n");

  const comments = output.findings.filter(isInline).map((finding) => ({
    path: finding.path,
    line: finding.line,
    side: "RIGHT" as const,
    body: `**${finding.title}**\n\n${finding.body}`,
  }));

  return { body: `${body}\n`, comments };
};

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}.`);
  return value;
};

const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`No value for ${placeholder}.`);
    return value;
  });

// Read-only: files, four git commands that only read history, and sub-agents
// with the same limits. Anything else is denied without asking.
// Flags: https://code.claude.com/docs/en/cli-reference
const claudeArgs = (schema: string, readDir: string): string[] => [
  // Run once, non-interactively, and exit (headless mode).
  // https://code.claude.com/docs/en/headless
  "--print",
  // No command-running tools unless named in --tools; file tools stay inside
  // the working directories; settings files in the checkout are ignored.
  "--restricted",
  // No MCP servers, not even ones a .mcp.json in the checkout configures.
  "--strict-mcp-config",
  // The only tools that exist: reading files, the shell, and sub-agents.
  "--tools",
  "Read,Glob,Grep,Bash,Agent",
  // Shell commands that run without asking: git commands that read history.
  // Every other call needs approval, and in print mode nobody can give it, so
  // it's denied. (No --permission-mode: the env scrub below forces the default.)
  // https://code.claude.com/docs/en/permissions
  "--allowedTools",
  "Bash(git diff *)",
  "Bash(git log *)",
  "Bash(git rev-parse *)",
  "Bash(git show *)",
  // Denied outright, even if a setting allowed them.
  "--disallowedTools",
  "Edit,Write,NotebookEdit",
  // One more directory it may read: the one holding the ticket.
  "--add-dir",
  readDir,
  // Print one JSON object with the run's result and metadata.
  "--output-format",
  "json",
  // Make the answer match this schema; it arrives in `structured_output`.
  "--json-schema",
  schema,
];

const main = (): void => {
  const baseRef = required("BASE_REF");
  const ticket = required("TICKET");
  const base = join(import.meta.dirname, "..", "..");

  const prompt = fill(
    readFileSync(join(base, ".github/factory/review.md"), "utf8"),
    {
      PR_NUMBER: required("PR_NUMBER"),
      BASE_REF: baseRef,
      SKILL: join(base, ".agents/skills/code-review/SKILL.md"),
      STANDARDS: join(base, "CODING_STANDARDS.md"),
      SPEC: ticket,
    },
  );
  const schema = readFileSync(
    join(base, ".github/factory/review-schema.json"),
    "utf8",
  );

  const claude = spawnSync("claude", claudeArgs(schema, join(ticket, "..")), {
    input: prompt,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // Strip credentials (the Claude token) from the shell commands it runs.
    // https://code.claude.com/docs/en/env-vars
    env: { ...process.env, CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1" },
  });
  if (claude.status !== 0) {
    throw new Error(`claude exited with ${claude.status}: ${claude.stderr}`);
  }
  const result = JSON.parse(claude.stdout);
  console.log(
    JSON.stringify({ subtype: result.subtype, turns: result.num_turns }),
  );
  for (const denial of result.permission_denials ?? []) {
    console.log(`Denied: ${JSON.stringify(denial.tool_input)}`);
  }
  // `--json-schema` made the CLI validate structured_output against the schema.
  const output: ReviewOutput | undefined = result.structured_output;
  if (!output) throw new Error(`No structured output (${result.subtype}).`);

  const diff = execFileSync("git", ["diff", `origin/${baseRef}...HEAD`], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const review = renderReview(
    output,
    commentableLines(diff),
    required("RUN_URL"),
  );
  writeFileSync(
    required("REVIEW_OUT"),
    JSON.stringify({
      commit_id: required("HEAD_SHA"),
      event: "COMMENT",
      ...review,
    }),
  );
};

if (import.meta.main) main();
