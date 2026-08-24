const ts = require("module").createRequire("/home/suryaprakash/Docker/nexora/mobile/package.json")("typescript");
const fs = require("fs"), path = require("path");
const HOOK_RE = /^use[A-Z]/;
function checkFile(file){
  const sf = ts.createSourceFile(file, fs.readFileSync(file,"utf8"), ts.ScriptTarget.Latest, true);
  const issues = [];
  function visit(fnNode){
    const body = fnNode.body && ts.isBlock(fnNode.body) ? fnNode.body : null;
    if (!body) { ts.forEachChild(fnNode, visit); return; }
    let returned = false;
    for (const st of body.statements){
      const hooksInStmt = [];
      (function fh(n){
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && HOOK_RE.test(n.expression.text)) hooksInStmt.push(n.expression.text);
        if (!(ts.isFunctionDeclaration(n)||ts.isFunctionExpression(n)||ts.isArrowFunction(n)||ts.isMethodDeclaration(n))) ts.forEachChild(n, fh);
      })(st);
      if (returned && hooksInStmt.length)
        issues.push(`${file}:${sf.getLineAndCharacterOfPosition(st.getStart()).line+1} hook(${hooksInStmt.join(",")}) AFTER early-return`);
      if (ts.isReturnStatement(st)) returned = true;
      (function rec(n){
        if ((ts.isFunctionDeclaration(n)||ts.isFunctionExpression(n)||ts.isArrowFunction(n)||ts.isMethodDeclaration(n))) { visit(n); return; }
        ts.forEachChild(n, (c)=>rec(c));
      })(st);
    }
    (function guarded(n){
      ts.forEachChild(n, (c)=>{
        if (ts.isIfStatement(c)||ts.isForStatement(c)||ts.isForOfStatement(c)||ts.isWhileStatement(c)){
          const inner=[];
          (function fh2(x){ if (ts.isCallExpression(x)&&ts.isIdentifier(x.expression)&&HOOK_RE.test(x.expression.text)) inner.push(x.expression.text); ts.forEachChild(x,fh2); })(c.thenStatement||c.statement);
          if (inner.length) issues.push(`${file}:${sf.getLineAndCharacterOfPosition(c.getStart()).line+1} hook(${inner.join(",")}) inside ${ts.SyntaxKind[c.kind]}`);
        }
        guarded(c);
      });
    })(body);
    ts.forEachChild(fnNode, visit);
  }
  visit(sf);
  return issues;
}
const root = process.argv[2] || "src";
if (!fs.existsSync(root)) { console.error(`path not found: ${root}`); process.exit(2); }
const out=[];
(function walk(dir){
  for (const f of fs.readdirSync(dir)){
    const fp = path.join(dir,f);
    const st = fs.statSync(fp);
    if (st.isDirectory()) { if (!/node_modules|\.git|dist|build|target/.test(fp)) walk(fp); }
    else if (/\.tsx?$/.test(f)) out.push(...checkFile(fp));
  }
})(root);
console.log(out.length ? out.join("\n") : "NO VIOLATIONS");
