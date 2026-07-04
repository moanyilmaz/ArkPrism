const fs = require('fs');
const path = require('path');

const DEFAULT_EXCLUDED_DIRS = new Set([
  'build',
  'cache',
  'node_modules',
  'oh_modules',
  '.preview',
  '.git',
  'hvigor',
  '.hvigor',
  'resources',
  'rawfile',
  'archive_files',
]);

const DEFAULT_EXTENSIONS = new Set(['.ets', '.ts', '.js', '.vue']);

const PACKAGE_ALIASES = new Map([
  ['@ohos.distributedDeviceManager', ['@kit.DistributedServiceKit']],
  ['@kit.DistributedServiceKit', ['@ohos.distributedDeviceManager']],
  ['@ohos.deviceInfo', ['@kit.BasicServicesKit']],
  ['@kit.BasicServicesKit', ['@ohos.deviceInfo', '@ohos.request', '@ohos.pasteboard']],
  ['@ohos.multimedia.audio', ['@kit.AudioKit']],
  ['@kit.AudioKit', ['@ohos.multimedia.audio']],
  ['@ohos.geoLocationManager', ['@kit.LocationKit']],
  ['@ohos.geolocation', ['@kit.LocationKit', '@ohos.geoLocationManager']],
  ['@kit.LocationKit', ['@ohos.geoLocationManager', '@ohos.geolocation']],
  ['@ohos.sensor', ['@kit.SensorServiceKit']],
  ['@kit.SensorServiceKit', ['@ohos.sensor']],
  ['@ohos.wifiManager', ['@kit.ConnectivityKit']],
  ['@kit.ConnectivityKit', ['@ohos.wifiManager']],
]);

function parseArgs(argv) {
  const args = {
    datasetDir: 'dataset',
    reportsDir: 'out_full_sdk_20260702_final2',
    sensitiveApisPath: path.join('config', 'sensitive_apis.json'),
    outputDir: path.join('docs', 'generated_source_annotations'),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dataset') args.datasetDir = argv[++i];
    else if (arg === '--reports') args.reportsDir = argv[++i];
    else if (arg === '--sensitive-apis') args.sensitiveApisPath = argv[++i];
    else if (arg === '--output-dir') args.outputDir = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log([
        'Usage:',
        '  node scripts/annotate_sensitive_api_source.js --dataset dataset --reports out --output-dir docs/generated_source_annotations',
        '',
        'Scans source files for sensitive API evidence from config/sensitive_apis.json.',
        'Outputs both raw method-string hits and import-qualified namespace.method hits.',
      ].join('\n'));
      process.exit(0);
    }
  }

  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lineColumnAt(text, index) {
  const prefix = text.slice(0, index);
  const lines = prefix.split(/\r\n|\r|\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function shouldSkipDir(dirName) {
  return DEFAULT_EXCLUDED_DIRS.has(dirName);
}

function walkSourceFiles(rootDir) {
  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) stack.push(fullPath);
      } else if (entry.isFile() && DEFAULT_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }

  return files.sort();
}

function relatedPackages(importFrom) {
  return [importFrom, ...(PACKAGE_ALIASES.get(importFrom) || [])];
}

function namespaceMatches(ruleNamespace, importedName, importFrom) {
  if (!ruleNamespace || !importedName) return false;
  if (ruleNamespace === importedName) return true;
  if (ruleNamespace.toLowerCase() === importedName.toLowerCase()) return true;

  if (importFrom === '@ohos.distributedDeviceManager' && importedName === 'deviceManager') {
    return ruleNamespace === 'DeviceManager' || ruleNamespace === 'distributedDeviceManager';
  }

  if (importFrom === '@ohos.deviceInfo' && importedName === 'deviceInfo') {
    return ruleNamespace === 'deviceInfo' || ruleNamespace === 'deviceinfo';
  }

  if ((importFrom === '@ohos.geoLocationManager' || importFrom === '@ohos.geolocation' || importFrom === '@kit.LocationKit') &&
      (importedName === 'geoLocationManager' || importedName === 'geolocation')) {
    return ruleNamespace === 'geoLocationManager' || ruleNamespace === 'geolocation';
  }

  if (importFrom === '@ohos.wifiManager') {
    return ruleNamespace === 'wifiManager';
  }

  return false;
}

function stripCommentsPreservePositions(text) {
  let result = '';
  let state = 'code';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (state === 'code') {
      if (ch === '/' && next === '/') {
        result += '  ';
        i++;
        state = 'lineComment';
      } else if (ch === '/' && next === '*') {
        result += '  ';
        i++;
        state = 'blockComment';
      } else if (ch === '"' || ch === "'" || ch === '`') {
        result += ch;
        state = ch;
      } else {
        result += ch;
      }
      continue;
    }

    if (state === 'lineComment') {
      if (ch === '\r' || ch === '\n') {
        result += ch;
        state = 'code';
      } else {
        result += ' ';
      }
      continue;
    }

    if (state === 'blockComment') {
      if (ch === '*' && next === '/') {
        result += '  ';
        i++;
        state = 'code';
      } else {
        result += ch === '\r' || ch === '\n' ? ch : ' ';
      }
      continue;
    }

    result += ch;
    if (ch === '\\') {
      if (i + 1 < text.length) {
        result += text[i + 1];
        i++;
      }
    } else if (ch === state) {
      state = 'code';
    }
  }
  return result;
}

function stripStringsPreservePositions(text) {
  let result = '';
  let state = 'code';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (state === 'code') {
      if (ch === '"' || ch === "'" || ch === '`') {
        result += ' ';
        state = ch;
      } else {
        result += ch;
      }
      continue;
    }

    if (ch === '\\') {
      result += ' ';
      if (i + 1 < text.length) {
        result += text[i + 1] === '\r' || text[i + 1] === '\n' ? text[i + 1] : ' ';
        i++;
      }
    } else if (ch === state) {
      result += ' ';
      state = 'code';
    } else {
      result += ch === '\r' || ch === '\n' ? ch : ' ';
    }
  }
  return result;
}

function loadRules(filePath) {
  const packages = readJson(filePath);
  const rules = [];
  const methodNames = new Set();

  for (const pkg of packages) {
    for (const api of pkg.privacyApis || []) {
      if (!api.method || !api.namespace) continue;
      const rule = {
        systemPackage: pkg.systemPackage,
        namespace: api.namespace,
        method: api.method,
        permission: api.permission || null,
        profilingCategory: api.profilingCategory || '',
        directCall: api.directCall,
        key: `${pkg.systemPackage}|${api.namespace}|${api.method}`,
      };
      rules.push(rule);
      methodNames.add(api.method);
    }
  }

  const rulesByPackage = new Map();
  for (const rule of rules) {
    if (!rulesByPackage.has(rule.systemPackage)) {
      rulesByPackage.set(rule.systemPackage, []);
    }
    rulesByPackage.get(rule.systemPackage).push(rule);
  }

  return { rules, rulesByPackage, methodNames: Array.from(methodNames).sort() };
}

function parseNamedImports(namedClause) {
  return namedClause
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const aliasMatch = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (aliasMatch) return { importedName: aliasMatch[1], localName: aliasMatch[2] };
      return { importedName: part, localName: part };
    });
}

function defaultImportNameForPackage(importFrom, localName) {
  if (importFrom === '@ohos.deviceInfo') return 'deviceInfo';
  if (importFrom === '@ohos.distributedDeviceManager') return 'deviceManager';
  if (importFrom === '@ohos.wifiManager') return 'wifiManager';
  const suffix = importFrom.split(/[./]/).filter(Boolean).pop();
  return suffix || localName;
}

function parseImports(text) {
  const imports = [];
  const importRegex = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(text)) !== null) {
    const clause = match[1].trim().replace(/\s+/g, ' ');
    const importFrom = match[2];
    if (!importFrom.startsWith('@kit.') && !importFrom.startsWith('@ohos.') && !importFrom.startsWith('@hms.')) {
      continue;
    }

    const namespaceMatch = clause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (namespaceMatch) {
      imports.push({
        importFrom,
        importedName: namespaceMatch[1],
        localName: namespaceMatch[1],
        kind: 'namespace',
      });
      continue;
    }

    const namedMatch = clause.match(/\{([^}]+)\}/);
    if (namedMatch) {
      for (const item of parseNamedImports(namedMatch[1])) {
        imports.push({ importFrom, ...item, kind: 'named' });
      }
    }

    const defaultPart = clause.replace(/\{[^}]+\}/, '').replace(/,$/, '').trim();
    if (defaultPart && /^[A-Za-z_$][\w$]*$/.test(defaultPart)) {
      imports.push({
        importFrom,
        importedName: defaultImportNameForPackage(importFrom, defaultPart),
        localName: defaultPart,
        kind: 'default',
      });
    }
  }

  return imports;
}

function rawMethodHits(text, projectDir, filePath, methodNames) {
  const hits = [];
  for (const method of methodNames) {
    let index = text.indexOf(method);
    if (index < 0) continue;
    const pos = lineColumnAt(text, index);
    hits.push({
      method,
      file: path.relative(projectDir, filePath).replace(/\\/g, '/'),
      line: pos.line,
      column: pos.column,
    });
  }
  return hits;
}

function findAllMatches(text, regex) {
  const matches = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.push({ index: match.index, text: match[0] });
    if (match.index === regex.lastIndex) regex.lastIndex++;
  }
  return matches;
}

function qualifiedHits(text, projectDir, filePath, imports, rulesByPackage) {
  const hits = [];
  const seen = new Set();

  for (const importInfo of imports) {
    const candidateRules = [];
    for (const pkg of relatedPackages(importInfo.importFrom)) {
      candidateRules.push(...(rulesByPackage.get(pkg) || []));
    }

    for (const rule of candidateRules) {
      if (!namespaceMatches(rule.namespace, importInfo.importedName, importInfo.importFrom)) continue;

      const local = escapeRegExp(importInfo.localName);
      const methodText = rule.method.replace(/\(\)$/, '');
      const eventArg = methodText.match(/['"]([^'"]+)['"]/);
      const methodBase = methodText.replace(/\s*\(.*/, '');
      const method = escapeRegExp(methodBase);
      const memberRegex = new RegExp(`\\b${local}\\s*(?:\\?\\.)?\\.\\s*${method}\\b`, 'g');
      const bracketRegex = new RegExp(`\\b${local}\\s*(?:\\?\\.)?\\[\\s*['"]${method}['"]\\s*\\]`, 'g');

      for (const found of [...findAllMatches(text, memberRegex), ...findAllMatches(text, bracketRegex)]) {
        if (eventArg) {
          const nearby = text.slice(found.index, Math.min(text.length, found.index + 240));
          const expected = eventArg[1];
          const expectedTail = expected.split('.').pop() || expected;
          if (!nearby.includes(expected) && !nearby.includes(expectedTail)) continue;
        }
        const pos = lineColumnAt(text, found.index);
        const key = `${rule.key}|${filePath}|${pos.line}|${pos.column}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({
          confidence: 'qualified',
          systemPackage: rule.systemPackage,
          namespace: rule.namespace,
          method: rule.method,
          permission: rule.permission,
          profilingCategory: rule.profilingCategory,
          importFrom: importInfo.importFrom,
          importedName: importInfo.importedName,
          localName: importInfo.localName,
          file: path.relative(projectDir, filePath).replace(/\\/g, '/'),
          line: pos.line,
          column: pos.column,
          evidence: found.text,
        });
      }
    }
  }

  return hits;
}

function presenceHits(text, projectDir, filePath, imports, rulesByPackage) {
  const hits = [];
  const seen = new Set();

  function addHit(rule, importInfo, found) {
    const pos = lineColumnAt(text, found.index);
    const key = `${rule.key}|${filePath}|${pos.line}|${pos.column}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({
      confidence: 'presence',
      systemPackage: rule.systemPackage,
      namespace: rule.namespace,
      method: rule.method,
      permission: rule.permission,
      profilingCategory: rule.profilingCategory,
      importFrom: importInfo.importFrom,
      importedName: importInfo.importedName,
      localName: importInfo.localName,
      file: path.relative(projectDir, filePath).replace(/\\/g, '/'),
      line: pos.line,
      column: pos.column,
      evidence: found.text,
    });
  }

  for (const importInfo of imports) {
    const candidateRules = [];
    for (const pkg of relatedPackages(importInfo.importFrom)) {
      candidateRules.push(...(rulesByPackage.get(pkg) || []));
    }

    const local = escapeRegExp(importInfo.localName);
    const typedReceivers = new Map();
    const localIdentifier = escapeRegExp(importInfo.localName);
    const typePattern = `${localIdentifier}\\s*\\.\\s*[A-Za-z_$][\\w$]*(?:\\s*\\.\\s*[A-Za-z_$][\\w$]*)*`;
    const receiverRegexes = [
      new RegExp(`\\b(?:let|const|var)\\s+([A-Za-z_$][\\w$]*)\\s*:\\s*(${typePattern})`, 'g'),
      new RegExp(`[,(]\\s*([A-Za-z_$][\\w$]*)\\s*:\\s*(${typePattern})`, 'g'),
    ];
    for (const regex of receiverRegexes) {
      let match;
      while ((match = regex.exec(text)) !== null) {
        typedReceivers.set(match[1], match[2].replace(/\s+/g, ''));
        if (match.index === regex.lastIndex) regex.lastIndex++;
      }
    }

    for (const rule of candidateRules) {
      if (!namespaceMatches(rule.namespace, importInfo.importedName, importInfo.importFrom)) continue;

      const methodText = rule.method.replace(/\(\)$/, '');
      const eventArg = methodText.match(/['"]([^'"]+)['"]/);
      const methodBase = methodText.replace(/\s*\(.*/, '');
      const methodTail = methodBase.split('.').filter(Boolean).pop() || methodBase;
      const methodCandidates = Array.from(new Set([methodBase, methodTail]));
      const methodQualifier = methodBase.includes('.')
        ? methodBase.split('.').filter(Boolean).slice(0, -1).join('.')
        : '';
      const matches = [];

      for (const methodCandidate of methodCandidates) {
        const method = escapeRegExp(methodCandidate);
        matches.push(
          ...findAllMatches(text, new RegExp(`\\b${local}\\s*(?:\\?\\.)?\\.\\s*${method}\\b`, 'g')),
          ...findAllMatches(text, new RegExp(`\\b${local}\\s*(?:\\?\\.)?\\[\\s*['"]${method}\\s*['"]\\s*\\]`, 'g')),
        );
        if (!methodQualifier || methodCandidate !== methodTail) continue;
        for (const [receiver, receiverType] of typedReceivers) {
          if (receiverType !== methodQualifier) continue;
          const receiverEscaped = escapeRegExp(receiver);
          matches.push(
            ...findAllMatches(text, new RegExp(`\\b${receiverEscaped}\\s*(?:\\?\\.)?\\.\\s*${method}\\b`, 'g')),
            ...findAllMatches(text, new RegExp(`\\b${receiverEscaped}\\s*(?:\\?\\.)?\\[\\s*['"]${method}\\s*['"]\\s*\\]`, 'g')),
          );
        }
      }

      for (const found of matches) {
        if (eventArg) {
          const nearby = text.slice(found.index, Math.min(text.length, found.index + 240));
          const expected = eventArg[1];
          const expectedTail = expected.split('.').pop() || expected;
          if (!nearby.includes(expected) && !nearby.includes(expectedTail)) continue;
        }
        addHit(rule, importInfo, found);
      }
    }
  }

  return hits;
}

function reportPathForProject(reportsDir, projectName) {
  return path.join(reportsDir, projectName, `${projectName}-arkprism-report.json`);
}

function loadDetected(reportPath) {
  if (!fs.existsSync(reportPath)) return [];
  const report = readJson(reportPath);
  return (report.privacyApiUsages || []).map(usage => ({
    systemPackage: usage.apiPackage || '',
    namespace: usage.namespace || '',
    method: usage.method || '',
    file: usage.file || '',
    code: usage.code || '',
    declaringMethod: usage.declaringMethod || '',
    key: `${usage.namespace || ''}|${usage.method || ''}`,
  }));
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const results = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(item);
  }
  return results;
}

function normalizedNamespace(namespace) {
  const value = String(namespace || '');
  if (value === 'geolocation') return 'geolocationmanager';
  if (value === 'deviceinfo') return 'deviceinfo';
  const lower = value.toLowerCase();
  if (lower === 'devicemanager' || lower === 'distributeddevicemanager') return 'distributeddevicemanager';
  return lower;
}

function normalizedMethod(method) {
  const base = String(method || '').replace(/\(\)\s*$/, '').replace(/\s*\(.*/, '');
  return base.split('.').filter(Boolean).pop() || base;
}

function apiCompareKey(namespace, method) {
  return `${normalizedNamespace(namespace)}|${normalizedMethod(method)}`;
}

function sourceLocationKey(hit) {
  return [
    apiCompareKey(hit.namespace, hit.method),
    hit.file || '',
    hit.line || '',
    hit.column || '',
    hit.evidence || '',
  ].join('|');
}

function dedupeSourceHits(hits) {
  return uniqueBy(hits, sourceLocationKey);
}

function validateAnnotationResults(projects) {
  const validation = {
    duplicatePresenceSourceHits: 0,
    duplicateQualifiedSourceHits: 0,
    declarationLikePresenceEvidence: 0,
    presenceEvidenceWithoutMemberAccess: 0,
    examples: {
      duplicatePresenceSourceHits: [],
      duplicateQualifiedSourceHits: [],
      declarationLikePresenceEvidence: [],
      presenceEvidenceWithoutMemberAccess: [],
    },
  };

  function addExample(kind, value) {
    if (validation.examples[kind].length < 10) {
      validation.examples[kind].push(value);
    }
  }

  function countDuplicates(project, hits, kind) {
    const seen = new Set();
    for (const hit of hits) {
      const key = sourceLocationKey(hit);
      if (seen.has(key)) {
        validation[kind]++;
        addExample(kind, {
          projectName: project.projectName,
          file: hit.file,
          line: hit.line,
          evidence: hit.evidence,
          namespace: hit.namespace,
          method: hit.method,
        });
      }
      seen.add(key);
    }
  }

  const declarationLike = /\b(function|async|static|private|public|protected)\s+[A-Za-z_$][\w$]*\s*\(/;
  for (const project of projects) {
    countDuplicates(project, project.presenceHits || [], 'duplicatePresenceSourceHits');
    countDuplicates(project, project.qualifiedHits || [], 'duplicateQualifiedSourceHits');
    for (const hit of project.presenceHits || []) {
      if (declarationLike.test(hit.evidence || '')) {
        validation.declarationLikePresenceEvidence++;
        addExample('declarationLikePresenceEvidence', {
          projectName: project.projectName,
          file: hit.file,
          line: hit.line,
          evidence: hit.evidence,
          namespace: hit.namespace,
          method: hit.method,
        });
      }
      if (!String(hit.evidence || '').includes('.')) {
        validation.presenceEvidenceWithoutMemberAccess++;
        addExample('presenceEvidenceWithoutMemberAccess', {
          projectName: project.projectName,
          file: hit.file,
          line: hit.line,
          evidence: hit.evidence,
          namespace: hit.namespace,
          method: hit.method,
        });
      }
    }
  }

  return validation;
}

function analyzeProject(projectName, datasetDir, reportsDir, rulesByPackage, methodNames) {
  const projectDir = path.join(datasetDir, projectName);
  const files = walkSourceFiles(projectDir);
  const rawHits = [];
  const qualified = [];
  const presence = [];

  for (const filePath of files) {
    let text;
    try {
      text = stripCommentsPreservePositions(fs.readFileSync(filePath, 'utf8'));
    } catch {
      continue;
    }
    const codeText = stripStringsPreservePositions(text);
    rawHits.push(...rawMethodHits(text, projectDir, filePath, methodNames));
    const imports = parseImports(text);
    qualified.push(...qualifiedHits(codeText, projectDir, filePath, imports, rulesByPackage));
    presence.push(...presenceHits(codeText, projectDir, filePath, imports, rulesByPackage));
  }

  const canonicalPresence = dedupeSourceHits(presence);
  const canonicalQualified = dedupeSourceHits(qualified);
  const detected = loadDetected(reportPathForProject(reportsDir, projectName));
  const presenceMethodSet = new Set(canonicalPresence.map(hit => apiCompareKey(hit.namespace, hit.method)));
  const qualifiedMethodSet = new Set(canonicalQualified.map(hit => apiCompareKey(hit.namespace, hit.method)));
  const detectedMethodSet = new Set(detected.map(hit => apiCompareKey(hit.namespace, hit.method)));
  const presenceMissingInReport = uniqueBy(
    canonicalPresence.filter(hit => !detectedMethodSet.has(apiCompareKey(hit.namespace, hit.method))),
    sourceLocationKey,
  );
  const qualifiedMissingInReport = uniqueBy(
    canonicalQualified.filter(hit => !detectedMethodSet.has(apiCompareKey(hit.namespace, hit.method))),
    sourceLocationKey,
  );
  const detectedWithoutPresenceSource = uniqueBy(
    detected.filter(hit => !presenceMethodSet.has(apiCompareKey(hit.namespace, hit.method))),
    hit => `${hit.namespace}|${hit.method}`,
  );
  const detectedWithoutQualifiedSource = uniqueBy(
    detected.filter(hit => !qualifiedMethodSet.has(apiCompareKey(hit.namespace, hit.method))),
    hit => `${hit.namespace}|${hit.method}`,
  );

  return {
    projectName,
    fileCount: files.length,
    rawMethodCount: new Set(rawHits.map(hit => hit.method)).size,
    presenceApiCount: canonicalPresence.length,
    presenceMethodCount: presenceMethodSet.size,
    qualifiedApiCount: canonicalQualified.length,
    qualifiedMethodCount: qualifiedMethodSet.size,
    detectedMethodCount: detectedMethodSet.size,
    presenceMissingInReportCount: presenceMissingInReport.length,
    qualifiedMissingInReportCount: qualifiedMissingInReport.length,
    detectedWithoutPresenceSourceCount: detectedWithoutPresenceSource.length,
    detectedWithoutQualifiedSourceCount: detectedWithoutQualifiedSource.length,
    rawHits: rawHits.slice(0, 500),
    presenceHits: canonicalPresence,
    qualifiedHits: canonicalQualified,
    detected,
    presenceMissingInReport,
    qualifiedMissingInReport,
    detectedWithoutPresenceSource,
    detectedWithoutQualifiedSource,
  };
}

function writeMarkdown(summary, outputPath) {
  const lines = [];
  lines.push('# Sensitive API Source Annotation Report');
  lines.push('');
  lines.push(`- Projects: ${summary.projectCount}`);
  lines.push(`- Raw method-name hits: ${summary.totalRawMethodHits}`);
  lines.push(`- Presence source hits: ${summary.totalPresenceHits}`);
  lines.push(`- Presence source methods: ${summary.totalPresenceMethods}`);
  lines.push(`- Presence source hits missing in ArkPrism report: ${summary.totalPresenceMissingInReport}`);
  lines.push(`- Qualified source hits: ${summary.totalQualifiedHits}`);
  lines.push(`- Qualified source methods: ${summary.totalQualifiedMethods}`);
  lines.push(`- Qualified source hits missing in ArkPrism report: ${summary.totalQualifiedMissingInReport}`);
  lines.push(`- Validation duplicate presence hits: ${summary.validation.duplicatePresenceSourceHits}`);
  lines.push(`- Validation duplicate qualified hits: ${summary.validation.duplicateQualifiedSourceHits}`);
  lines.push(`- Validation declaration-like presence evidence: ${summary.validation.declarationLikePresenceEvidence}`);
  lines.push(`- Validation presence evidence without member access: ${summary.validation.presenceEvidenceWithoutMemberAccess}`);
  lines.push('');
  lines.push('| Project | Files | Raw Methods | Presence Hits | Presence Methods | Qualified Hits | Qualified Methods | Detected Methods | Presence Missing | Qualified Missing | Detected Without Presence |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const project of summary.projects) {
    lines.push(`| ${project.projectName} | ${project.fileCount} | ${project.rawMethodCount} | ${project.presenceApiCount} | ${project.presenceMethodCount} | ${project.qualifiedApiCount} | ${project.qualifiedMethodCount} | ${project.detectedMethodCount} | ${project.presenceMissingInReportCount} | ${project.qualifiedMissingInReportCount} | ${project.detectedWithoutPresenceSourceCount} |`);
  }

  lines.push('');
  lines.push('## Presence Missing In Report');
  lines.push('');
  for (const project of summary.projects.filter(p => p.presenceMissingInReport.length > 0)) {
    lines.push(`### ${project.projectName}`);
    lines.push('');
    for (const hit of project.presenceMissingInReport.slice(0, 50)) {
      lines.push(`- ${hit.namespace}.${hit.method} at ${hit.file}:${hit.line} (${hit.evidence})`);
    }
    lines.push('');
  }

  lines.push('');
  lines.push('## Qualified Missing In Report');
  lines.push('');
  for (const project of summary.projects.filter(p => p.qualifiedMissingInReport.length > 0)) {
    lines.push(`### ${project.projectName}`);
    lines.push('');
    for (const hit of project.qualifiedMissingInReport.slice(0, 50)) {
      lines.push(`- ${hit.namespace}.${hit.method} at ${hit.file}:${hit.line} (${hit.evidence})`);
    }
    lines.push('');
  }

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const datasetDir = path.resolve(args.datasetDir);
  const reportsDir = path.resolve(args.reportsDir);
  const outputDir = path.resolve(args.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const { rulesByPackage, methodNames } = loadRules(path.resolve(args.sensitiveApisPath));
  const projects = fs.readdirSync(datasetDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();

  const projectResults = projects.map(projectName =>
    analyzeProject(projectName, datasetDir, reportsDir, rulesByPackage, methodNames)
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    datasetDir,
    reportsDir,
    sensitiveApisPath: path.resolve(args.sensitiveApisPath),
    projectCount: projectResults.length,
    totalRawMethodHits: projectResults.reduce((n, p) => n + p.rawHits.length, 0),
    totalPresenceHits: projectResults.reduce((n, p) => n + p.presenceApiCount, 0),
    totalPresenceMethods: projectResults.reduce((n, p) => n + p.presenceMethodCount, 0),
    totalPresenceMissingInReport: projectResults.reduce((n, p) => n + p.presenceMissingInReportCount, 0),
    totalQualifiedHits: projectResults.reduce((n, p) => n + p.qualifiedApiCount, 0),
    totalQualifiedMethods: projectResults.reduce((n, p) => n + p.qualifiedMethodCount, 0),
    totalQualifiedMissingInReport: projectResults.reduce((n, p) => n + p.qualifiedMissingInReportCount, 0),
    validation: validateAnnotationResults(projectResults),
    projects: projectResults,
  };

  const jsonPath = path.join(outputDir, 'source_sensitive_api_annotations.json');
  const mdPath = path.join(outputDir, 'source_sensitive_api_annotations.md');
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf8');
  writeMarkdown(summary, mdPath);

  console.log(`[SOURCE-ANNOTATE] Projects: ${summary.projectCount}`);
  console.log(`[SOURCE-ANNOTATE] Raw method-name hits: ${summary.totalRawMethodHits}`);
  console.log(`[SOURCE-ANNOTATE] Presence source hits: ${summary.totalPresenceHits}`);
  console.log(`[SOURCE-ANNOTATE] Presence source methods: ${summary.totalPresenceMethods}`);
  console.log(`[SOURCE-ANNOTATE] Presence missing in report: ${summary.totalPresenceMissingInReport}`);
  console.log(`[SOURCE-ANNOTATE] Qualified source hits: ${summary.totalQualifiedHits}`);
  console.log(`[SOURCE-ANNOTATE] Qualified source methods: ${summary.totalQualifiedMethods}`);
  console.log(`[SOURCE-ANNOTATE] Qualified missing in report: ${summary.totalQualifiedMissingInReport}`);
  console.log(`[SOURCE-ANNOTATE] Validation duplicate presence hits: ${summary.validation.duplicatePresenceSourceHits}`);
  console.log(`[SOURCE-ANNOTATE] Validation declaration-like presence evidence: ${summary.validation.declarationLikePresenceEvidence}`);
  console.log(`[SOURCE-ANNOTATE] Validation presence evidence without member access: ${summary.validation.presenceEvidenceWithoutMemberAccess}`);
  console.log(`[SOURCE-ANNOTATE] JSON: ${jsonPath}`);
  console.log(`[SOURCE-ANNOTATE] Markdown: ${mdPath}`);
}

main();
