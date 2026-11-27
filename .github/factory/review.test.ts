import { describe, expect, it } from "vitest";
import { commentableLines, renderReview, type Finding } from "./review";

const diff = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,3 @@",
  " keep",
  "-old",
  "+new",
  " keep",
  "@@ -10,2 +10,3 @@ export const x = 1;",
  " ten",
  "+eleven",
  " twelve",
  "diff --git a/src/gone.ts b/src/gone.ts",
  "deleted file mode 100644",
  "index 3333333..0000000",
  "--- a/src/gone.ts",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-bye",
  "diff --git a/src/b.ts b/src/b.ts",
  "new file mode 100644",
  "index 0000000..4444444",
  "--- /dev/null",
  "+++ b/src/b.ts",
  "@@ -0,0 +1,2 @@",
  "+one",
  "+two",
  "",
].join("\n");

const finding = (overrides: Partial<Finding>): Finding => ({
  axis: "standards",
  title: "Non-null assertion",
  path: "src/a.ts",
  line: 2,
  body: "Breaks **Handle the missing case**.\n\nReturn early.",
  ...overrides,
});

const output = {
  standards: "Follows the rules.",
  spec: "Does what the ticket asks.",
  findings: [],
  missingRules: [],
};

describe("commentableLines", () => {
  it("records added and context lines on the new side", () => {
    expect([...(commentableLines(diff).get("src/a.ts") ?? [])]).toEqual([
      1, 2, 3, 10, 11, 12,
    ]);
  });

  it("records every line of a new file", () => {
    expect([...(commentableLines(diff).get("src/b.ts") ?? [])]).toEqual([1, 2]);
  });

  it("records nothing for a deleted file", () => {
    expect(commentableLines(diff).has("src/gone.ts")).toBe(false);
  });

  it("records a renamed file under its new name", () => {
    const renamed = commentableLines(
      [
        "diff --git a/src/old.ts b/src/new.ts",
        "similarity index 90%",
        "rename from src/old.ts",
        "rename to src/new.ts",
        "index 5555555..6666666 100644",
        "--- a/src/old.ts",
        "+++ b/src/new.ts",
        "@@ -1,2 +1,2 @@",
        " same",
        "-before",
        "+after",
        "",
      ].join("\n"),
    );

    expect([...(renamed.get("src/new.ts") ?? [])]).toEqual([1, 2]);
    expect(renamed.has("src/old.ts")).toBe(false);
  });

  it("doesn't count git's no-newline marker as a line", () => {
    const lines = commentableLines(
      [
        "diff --git a/src/c.ts b/src/c.ts",
        "index 7777777..8888888 100644",
        "--- a/src/c.ts",
        "+++ b/src/c.ts",
        "@@ -1 +1,2 @@",
        "-last",
        "\\ No newline at end of file",
        "+last",
        "+added",
        "",
      ].join("\n"),
    );

    expect([...(lines.get("src/c.ts") ?? [])]).toEqual([1, 2]);
  });
});

describe("renderReview", () => {
  const commentable = commentableLines(diff);
  const runUrl = "https://example.test/run/1";

  it("passes both axes when there are no findings", () => {
    const { body, comments } = renderReview(output, commentable, runUrl);

    expect(body).toContain("## Standards: PASS\n\nFollows the rules.");
    expect(body).toContain("## Spec: PASS\n\nDoes what the ticket asks.");
    expect(body).toContain(
      "## Rules this review wanted and could not find\n\nNone.",
    );
    expect(body).toContain(`([logs](${runUrl}))`);
    expect(comments).toEqual([]);
  });

  it("requests changes only on the axis with a finding", () => {
    const { body } = renderReview(
      { ...output, findings: [finding({ axis: "spec" })] },
      commentable,
      runUrl,
    );

    expect(body).toContain("## Standards: PASS");
    expect(body).toContain("## Spec: CHANGES REQUESTED");
  });

  it("posts a finding inside a hunk on its line, and lists it by title", () => {
    const { body, comments } = renderReview(
      { ...output, findings: [finding({})] },
      commentable,
      runUrl,
    );

    expect(comments).toEqual([
      {
        path: "src/a.ts",
        line: 2,
        side: "RIGHT",
        body: "**Non-null assertion**\n\nBreaks **Handle the missing case**.\n\nReturn early.",
      },
    ]);
    expect(body).toContain("- **Non-null assertion**, at `src/a.ts:2`");
    expect(body).not.toContain("Return early.");
  });

  it("writes a finding outside the hunks into the verdict in full", () => {
    const { body, comments } = renderReview(
      { ...output, findings: [finding({ line: 5 })] },
      commentable,
      runUrl,
    );

    expect(comments).toEqual([]);
    expect(body).toContain(
      "- **Non-null assertion**, at `src/a.ts:5`\n\n  Breaks **Handle the missing case**.\n\n  Return early.",
    );
  });

  it("lists an axis's findings as one list", () => {
    const { body } = renderReview(
      {
        ...output,
        findings: [finding({ title: "One" }), finding({ title: "Two" })],
      },
      commentable,
      runUrl,
    );

    expect(body).toContain(
      "- **One**, at `src/a.ts:2`\n- **Two**, at `src/a.ts:2`\n\n## Spec",
    );
  });

  it("lists the rules the review could not find", () => {
    const { body } = renderReview(
      { ...output, missingRules: ["No rule on file size.", "Nor on names."] },
      commentable,
      runUrl,
    );

    expect(body).toContain(
      "could not find\n\n- No rule on file size.\n- Nor on names.",
    );
  });
});
