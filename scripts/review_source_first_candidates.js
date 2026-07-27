const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    candidates: '',
    dataset: '',
    start: 0,
    count: 30,
  };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--candidates') args.candidates = path.resolve(argv[++index]);
    else if (argv[index] === '--dataset') args.dataset = path.resolve(argv[++index]);
    else if (argv[index] === '--start') args.start = Number(argv[++index]);
    else if (argv[index] === '--count') args.count = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!args.candidates || !args.dataset) {
    throw new Error('--candidates and --dataset are required');
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const data = JSON.parse(fs.readFileSync(args.candidates, 'utf8'));
const hits = [];
for (const project of data.projects) {
  for (const hit of project.presenceHits || []) {
    hits.push({ project: project.projectName, ...hit });
  }
}

for (let index = args.start; index < Math.min(hits.length, args.start + args.count); index++) {
  const hit = hits[index];
  const filePath = path.join(args.dataset, hit.project, hit.file);
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const first = Math.max(0, hit.line - 3);
  const last = Math.min(lines.length, hit.line + 2);
  console.log(`\n[${index}] ${hit.project} | ${hit.namespace}.${hit.method}`);
  console.log(`${hit.file}:${hit.line} | import=${hit.importFrom} | evidence=${hit.evidence}`);
  for (let line = first; line < last; line++) {
    console.log(`${line + 1}: ${lines[line]}`);
  }
}
console.log(`\nTOTAL=${hits.length}`);
