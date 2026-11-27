import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Axis = "standards" | "spec";

export type Finding = {
  axis: Axis;
  title: string;
  path: string;
  line: number;
  body: string;
};

export type ReviewOutput = {
  standards: string;
  spec: string;
  findings: Finding[];
  missingRules: string[];
};

// GitHub rejects a whole review if one inline comment is outside the diff, so
// only lines inside a hunk, on the new side, are commentable.
export const diffLines = (diff: string): Map<string, Set<number>> => {
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
  hunks: Map<string, Set<number>>,
  runUrl: string,
) => {
  const isInline = ({ path, line }: Finding) =>
    hunks.get(path)?.has(line) ?? false;

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
const claudeArgs = (schema: string, readDir: string): string[] => [
  "--print",
  "--restricted",
  "--strict-mcp-config",
  "--tools",
  "Read,Glob,Grep,Bash,Agent",
  "--allowedTools",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git rev-parse:*)",
  "Bash(git show:*)",
  "--disallowedTools",
  "Edit,Write,NotebookEdit",
  "--permission-mode",
  "dontAsk",
  "--add-dir",
  readDir,
  "--output-format",
  "json",
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
  const review = renderReview(output, diffLines(diff), required("RUN_URL"));
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
