/**
 * Guards the one React Compiler rule that nothing else in the toolchain will
 * tell you about.
 *
 * A `const` declared *after* an early return in a component body, and then
 * read from the JSX below it, can be mis-compiled: the compiler memoises the
 * body and the binding ends up out of scope by the time the markup reads it.
 * It cost a production-only `ReferenceError: used is not defined` on
 * 2026-08-23, on a component that dev, ESLint, `tsc --noEmit` and
 * `next build` all called clean. The bug is invisible until it is deployed,
 * which is exactly the kind that deserves a script.
 *
 * The rule: **compute everything before the first early return.**
 *
 *   node scripts/check-component-shape.mjs
 *
 * Brace depth is tracked so that a `return` inside an effect, a callback or
 * a nested function doesn't count — only the component's own top level does.
 * That distinction matters: without it every component with a `useEffect`
 * cleanup looks guilty.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["components", "app"];

/** Kept as a named constant: written inline it is one backslash away from
 *  becoming a literal newline, which is how this script broke once already. */
const SPLIT_LINES = new RegExp("\r?\n");

/** Hooks are allowed after an early return only in the sense that they never
 *  are — React forbids it, ESLint enforces it, so seeing one here means the
 *  line was misread rather than that a rule was broken. Skipped either way. */
const HOOK = /\b(useState|useEffect|useRef|useMemo|useCallback|useCached|useStored|useRouter|useSearchParams|useSyncExternalStore|useNearViewport)\s*[(<]/;

function tsxFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Strip the parts of a line that can hide braces, so depth stays honest. */
function code(line) {
  return line
    .replace(/\/\/.*$/, "")
    .replace(/(["'`]).*?\1/g, '""')
    .replace(/\/\*.*?\*\//g, "");
}

const problems = [];

/**
 * Whether a brace opened on this line begins a *function* rather than a
 * plain block. It is the distinction the whole check rests on: a `return`
 * inside `if (!data) { … }` is an early return from the component, while a
 * `return` inside `useEffect(() => { … })` is a cleanup and means nothing
 * here. Getting this wrong in either direction makes the check useless —
 * the first version missed every real case by only looking one level deep.
 */
function opensFunction(line) {
  return /=>|\bfunction\b|\.then\(|\.map\(|\.filter\(|\.catch\(/.test(line);
}

for (const root of ROOTS) {
  for (const file of tsxFiles(root)) {
    const lines = readFileSync(file, "utf8").split(SPLIT_LINES);

    /** One entry per open brace: true when it opened a function body. */
    const stack = [];
    let componentDepth = -1;
    let sawEarlyReturn = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = code(lines[i]);

      // Inside the component, and not inside any nested function within it?
      const inComponentTop =
        componentDepth >= 0 &&
        stack.length > componentDepth &&
        // From componentDepth + 1: the component's OWN brace is a function
        // brace, so slicing at componentDepth excluded every component body
        // and the check reported nothing but nested callbacks.
        !stack.slice(componentDepth + 1).some(Boolean);

      if (inComponentTop) {
        if (/(^|\s)return[\s(;]/.test(line)) {
          sawEarlyReturn ||= i + 1;
        } else if (
          sawEarlyReturn &&
          /^\s{2,}const\s+[\w{[]/.test(line) &&
          !HOOK.test(line) &&
          !opensFunction(line)
        ) {
          problems.push({
            file,
            line: i + 1,
            text: lines[i].trim().slice(0, 72),
            after: sawEarlyReturn,
          });
          sawEarlyReturn = 0; // one report per component is enough
        }
      }

      if (componentDepth < 0 && /^\s*(export default )?function [A-Z]/.test(line)) {
        componentDepth = stack.length;
        sawEarlyReturn = 0;
      }

      for (const ch of line) {
        if (ch === "{") stack.push(opensFunction(line));
        else if (ch === "}") {
          stack.pop();
          if (componentDepth >= 0 && stack.length <= componentDepth) {
            componentDepth = -1;
            sawEarlyReturn = 0;
          }
        }
      }
    }
  }
}

if (problems.length === 0) {
  console.log("✓ No component computes a value after an early return.");
  process.exit(0);
}

console.error(
  `✗ ${problems.length} value(s) computed after an early return.\n` +
    "  The React Compiler can emit these out of scope — a production-only\n" +
    "  ReferenceError that no local check will show you. Move the\n" +
    "  declaration above the first return.\n"
);
for (const p of problems) {
  console.error(`  ${p.file}:${p.line}  ${p.text}`);
  console.error(`    (returns early at line ${p.after})`);
}
process.exit(1);
