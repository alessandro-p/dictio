import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fill, required, runClaude } from "./claude.ts";

// This mirrors implement-schema.json. Change one, change the other.
type ImplementOutput = {
  /** The pull request description, in Markdown. */
  prBody: string;
};

// Edits files, runs pnpm, and commits through the pre-commit hook. It doesn't
// push: the workflow does that from another machine.
// Flags: https://code.claude.com/docs/en/cli-reference
const claudeArgs = (schema: string, readDir: string): string[] => [
  // Run once, non-interactively, and exit (headless mode).
  // https://code.claude.com/docs/en/headless
  "--print",
  // No permission checks, like the reference factory. An allowlist would not
  // hold here: `pnpm exec` runs any program. The wall is the workflow's job
  // split, which leaves this machine no secret but the Claude token.
  // https://code.claude.com/docs/en/permission-modes
  "--dangerously-skip-permissions",
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
  const ticket = required("TICKET");
  const prompt = fill(
    readFileSync(join(import.meta.dirname, "implement.md"), "utf8"),
    { TICKET: ticket },
  );
  const schema = readFileSync(
    join(import.meta.dirname, "implement-schema.json"),
    "utf8",
  );

  // `--json-schema` made the CLI validate the output against the schema.
  const output = runClaude(
    claudeArgs(schema, dirname(ticket)),
    prompt,
  ) as ImplementOutput;
  // In the log too, so a run that commits nothing still says why.
  console.log(output.prBody);
  writeFileSync(required("PR_BODY"), output.prBody);
};

if (import.meta.main) main();
