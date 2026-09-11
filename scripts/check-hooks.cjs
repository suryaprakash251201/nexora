// Rules-of-Hooks AST check shared by web/ and mobile/.
//
// Parses with @babel/parser instead of the TypeScript compiler API: TS7 (the
// native compiler) no longer exposes `createSourceFile`/`forEachChild` from
// the `typescript` package, and this check only needs a syntax tree. Both the
// Vite (web) and React Native (mobile) toolchains already ship @babel/parser.
//
// Flags two classes of violation:
//   1. a hook called after an early `return` in the same function body
//   2. a hook called inside a conditional / loop
// Nested function scopes are analyzed on their own (a hook inside a callback
// is fine), so the walks below stop at function boundaries.
const { createRequire } = require("module");
const path = require("path");
const fs = require("fs");

function loadParser() {
  const candidates = [
    process.cwd(),
    path.join(__dirname, "..", "web"),
    path.join(__dirname, "..", "mobile"),
  ];
  for (const dir of candidates) {
    try {
      return createRequire(path.join(dir, "package.json"))("@babel/parser");
    } catch {
      /* try next candidate */
    }
  }
  return require("@babel/parser");
}
const babelParser = loadParser();

const HOOK_RE = /^use[A-Z]/;

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);
const CONDITIONAL_TYPES = new Set([
  "IfStatement",
  "ForStatement",
  "ForOfStatement",
  "ForInStatement",
  "WhileStatement",
  "DoWhileStatement",
]);

function isFunction(node) {
  return !!node && FUNCTION_TYPES.has(node.type);
}

// Child nodes, skipping position/comment metadata.
function children(node) {
  const out = [];
  for (const key of Object.keys(node)) {
    if (
      key === "loc" ||
      key === "start" ||
      key === "end" ||
      key === "range" ||
      key === "leadingComments" ||
      key === "trailingComments" ||
      key === "innerComments"
    ) {
      continue;
    }
    const value = node[key];
    if (Array.isArray(value)) {
      for (const c of value) if (c && typeof c.type === "string") out.push(c);
    } else if (value && typeof value.type === "string") {
      out.push(value);
    }
  }
  return out;
}

function hookName(node) {
  if (
    node &&
    node.type === "CallExpression" &&
    node.callee &&
    node.callee.type === "Identifier" &&
    HOOK_RE.test(node.callee.name)
  ) {
    return node.callee.name;
  }
  return null;
}

// Hook calls within `node`, not descending into nested function scopes.
function collectHooks(node, out) {
  if (!node || typeof node.type !== "string") return;
  const name = hookName(node);
  if (name) out.push(name);
  if (isFunction(node)) return;
  for (const c of children(node)) collectHooks(c, out);
}

// A `return` reachable without crossing a nested function boundary.
function hasDirectReturn(node) {
  if (!node || typeof node.type !== "string") return false;
  if (node.type === "ReturnStatement") return true;
  if (isFunction(node)) return false;
  return children(node).some(hasDirectReturn);
}

// Statements whose direct `return` changes the hook count of later renders.
function conditionalTargets(node) {
  if (node.type === "IfStatement") return [node.consequent];
  if (node.type === "DoWhileStatement") return [node.body];
  if (
    node.type === "ForStatement" ||
    node.type === "ForOfStatement" ||
    node.type === "ForInStatement" ||
    node.type === "WhileStatement"
  ) {
    return [node.body];
  }
  return [];
}

function lineOf(node) {
  return node && node.loc ? node.loc.start.line : 0;
}

// Flag hooks inside conditionals/loops reachable from `node` without entering
// a nested function.
function findGuardedHooks(node, file, issues) {
  if (!node || typeof node.type !== "string") return;
  if (isFunction(node)) return;
  if (CONDITIONAL_TYPES.has(node.type)) {
    const hooks = [];
    for (const target of conditionalTargets(node)) collectHooks(target, hooks);
    if (hooks.length) {
      issues.push(`${file}:${lineOf(node)} hook(${hooks.join(",")}) inside ${node.type}`);
    }
  }
  for (const c of children(node)) findGuardedHooks(c, file, issues);
}

function checkFunction(fn, file, issues) {
  const body = fn.body;
  if (!body) return;
  const statements = body.type === "BlockStatement" ? body.body : [body];
  let returned = false;
  for (const st of statements) {
    const hooks = [];
    collectHooks(st, hooks);
    if (returned && hooks.length) {
      issues.push(`${file}:${lineOf(st)} hook(${hooks.join(",")}) AFTER early-return`);
    }
    if (st.type === "ReturnStatement") {
      returned = true;
    } else if (CONDITIONAL_TYPES.has(st.type)) {
      if (conditionalTargets(st).some(hasDirectReturn)) returned = true;
    }
    findGuardedHooks(st, file, issues);
  }
}

function checkFile(file, issues) {
  const code = fs.readFileSync(file, "utf8");
  const plugins = file.endsWith(".tsx") ? ["jsx", "typescript"] : ["typescript"];
  let ast;
  try {
    ast = babelParser.parse(code, {
      sourceType: "module",
      plugins,
      errorRecovery: false,
    });
  } catch (e) {
    issues.push(`${file}: parse error: ${e.message}`);
    return;
  }
  (function walk(node) {
    if (!node || typeof node.type !== "string") return;
    if (isFunction(node)) checkFunction(node, file, issues);
    for (const c of children(node)) walk(c);
  })(ast.program || ast);
}

const root = process.argv[2] || "src";
if (!fs.existsSync(root)) {
  console.error(`path not found: ${root}`);
  process.exit(2);
}
const issues = [];
(function collect(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (!/node_modules|\.git|dist|build|target/.test(full)) collect(full);
    } else if (/\.tsx?$/.test(full)) {
      checkFile(full, issues);
    }
  }
})(root);
console.log(issues.length ? issues.join("\n") : "NO VIOLATIONS");
if (issues.length) process.exit(1);
