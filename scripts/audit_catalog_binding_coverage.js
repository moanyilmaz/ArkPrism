const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const gold = require('../benchmarks/ArkPrismTop120/pac_v2/gold.json');
const selection = require('../benchmarks/ArkPrismTop120/pac_v2/selection_manifest.json');
const output = path.resolve(process.argv[2]);
const project = process.argv[3];
const normalize = s => s.replace(/\\/g, '/');

if (project) {
  const { Scene, SceneConfig } = require('../dist/arkanalyzer');
  const { getSceneFromJson, readPrivacyApis } = require('../dist/utils');
  const { analyzeFileForPrivacyApis } = require('../dist/apiDetector');
  const { analyzeViewTrees } = require('../dist/viewTreeAnalyzer');
  const { bindCatalogSources } = require('../dist/hapflow/CatalogSourceBindings');
  const directory = path.join(selection.dataset, project);
  let config = new SceneConfig();
  config.buildFromProjectDir(directory);
  let scene = getSceneFromJson(config);
  if (!scene.getFiles().length) {
    const skip = new Set(['build','cache','node_modules','oh_modules','.preview','.git','hvigor','.hvigor','resources','rawfile','archive_files']);
    function discover(dir) {
      return fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => e.isDirectory()
        ? skip.has(e.name) ? [] : discover(path.join(dir,e.name))
        : ['.ets','.ts'].includes(path.extname(e.name)) ? [path.join(dir,e.name)] : []);
    }
    config = new SceneConfig();
    config.buildFromProjectFiles(project, directory, discover(directory));
    scene = new Scene(); scene.buildBasicInfo(config); scene.genArkFiles(); scene.inferTypes();
  }
  analyzeViewTrees(scene);
  const rules = readPrivacyApis(path.join(root,'config/sensitive_apis.json'));
  const packages = [...new Set(rules.flatMap(p => [p.systemPackage, ...p.privacyApis.flatMap(a => a.packageAliases || [])]))];
  const usages = scene.getFiles().filter(f => !['build','cache','node_modules','oh_modules','.preview'].some(s => f.getName().includes(s)))
    .flatMap(f => analyzeFileForPrivacyApis(f, packages, rules));
  const bindings = bindCatalogSources(scene, usages, rules);
  const boundStatements = [...bindings.statements.entries()].flatMap(([stmt, sources]) =>
    (Array.isArray(sources) ? sources : [sources]).map(source => [stmt, source]));
  const annotations = gold.annotations.filter(a => a.project === project);
  const rows = annotations.map(a => {
    const usage = usages.find(u => normalize(u.file) === normalize(a.file) && u.line === a.line
      && u.catalogApiSignature === a.catalogApiSignature && u.dataType === a.dataType && u.label === a.label);
    const match = usage && boundStatements.find(([stmt, source]) => stmt.toString() === usage.code
      && stmt.getCfg().getDeclaringMethod().getSignature().toString() === usage.declaringMethod
      && source.rule.catalogApiSignature === usage.catalogApiSignature);
    return {file:a.file,line:a.line,api:a.catalogApiSignature,access:a.accessKind,recognized:!!usage,bound:!!match,
      carrier:match ? {kind:match[1].sourceType,callbackArgument:match[1].callbackIndex,
        parameter:match[1].sourceIndex,returnType:match[1].rule.returnType} : null};
  });
  fs.writeFileSync(path.join(output,`${project}.json`),JSON.stringify({project,stats:bindings.stats,rows},null,2));
} else {
  if (fs.existsSync(output)) throw new Error('Output exists');
  fs.mkdirSync(output,{recursive:true});
  const results = [];
  for (const item of selection.projects) {
    const start = Date.now();
    const child = spawnSync(process.execPath,['--max-old-space-size=8192',__filename,output,item.project],
      {cwd:root,encoding:'utf8',windowsHide:true,timeout:600000,maxBuffer:32*1024*1024});
    fs.writeFileSync(path.join(output,`${item.project}.log`),(child.stdout||'')+(child.stderr||''));
    const file = path.join(output,`${item.project}.json`);
    const result = child.status === 0 && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8'))
      : {project:item.project,error:child.error?.message||`exit ${child.status}`,rows:[]};
    results.push(result);
    const rows = results.flatMap(r=>r.rows);
    const summary = {projects:results.length,errors:results.filter(r=>r.error).length,
      gold:rows.length,recognized:rows.filter(r=>r.recognized).length,bound:rows.filter(r=>r.bound).length,
      unresolved:results.reduce((n,r)=>n+(r.stats?.unresolved.length||0),0)};
    fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify({
      scope:'Binding coverage at existing source-first gold API occurrences; carrier accuracy and complete paths require separate validation.',
      summary,results:results.map(({rows,...r})=>r)},null,2));
    console.log(item.project,`${result.rows.filter(r=>r.bound).length}/${result.rows.length} bound`,`${((Date.now()-start)/1000).toFixed(1)}s`);
  }
}
