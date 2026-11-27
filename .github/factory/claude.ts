import { spawnSync } from "node:child_process";

export const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}.`);
  return value;
};

export const fill = (
  template: string,
  values: Record<string, string>,
): string =>
  template.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`No value for ${placeholder}.`);
    return value;
  });

/**
 * Runs `claude` once with these flags and the prompt on stdin, and returns its
 * structured output. The flags must include `--output-format json` and
 * `--json-schema`, which makes the CLI validate the output against the schema.
 */
export const runClaude = (args: string[], prompt: string): unknown => {
  const claude = spawnSync("claude", args, {
    input: prompt,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
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
  if (!result.structured_output) {
    throw new Error(`No structured output (${result.subtype}).`);
  }
  return result.structured_output;
};
