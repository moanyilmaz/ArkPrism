/**
 * Compare HapFlow original BenchTest results vs ground truth
 */
const fs = require('fs');

// Parse BenchTest output
const benchOutput = fs.readFileSync('D:/Projects/Argus-0703/hapflow_artifact/hapflow/out/BenchOutput.txt', 'utf-8');
const benchResults = new Map();
for (const line of benchOutput.trim().split('\n')) {
    const parts = line.split(' , ');
    if (parts.length === 2) {
        const name = parts[0].replace('..\\HapBench\\', '').replace(/\\/g, '/');
        benchResults.set(name, parseInt(parts[1].trim()));
    }
}

// Parse ground truth
const gtContent = fs.readFileSync('D:/Projects/Argus-0703/hapflow_artifact/hapflow/out/HapBench.txt', 'utf-8');
const groundTruth = new Map();
for (const line of gtContent.trim().split('\n')) {
    const parts = line.split(' , ');
    if (parts.length === 2) {
        const name = parts[0].replace('..\\HapBench\\', '').replace(/\\/g, '/');
        groundTruth.set(name, parseInt(parts[1].trim()));
    }
}

// Parse our results
const ourResults = JSON.parse(fs.readFileSync('D:/Projects/Argus-0703/ArkPrism/docs/comparison_hapflow_vs_arkprism/hapbench_validation.json', 'utf-8'));

// Compare all three
console.log(`${'Test'.padEnd(55)} ${'GT'.padStart(4)} ${'HapFlow'.padStart(8)} ${'ArkPrism'.padStart(9)}`);
console.log('-'.repeat(80));

let gtVsHapMatch = 0, gtVsOursMatch = 0, hapVsOursMatch = 0;
let total = 0;
let tp_hap = 0, fp_hap = 0, fn_hap = 0, tn_hap = 0;
let tp_ours = 0, fp_ours = 0, fn_ours = 0, tn_ours = 0;

for (const [name, expected] of groundTruth) {
    const hapResult = benchResults.get(name) ?? -1;
    const ourResult = ourResults.results.find(r => r.name === name)?.actual ?? -1;
    total++;

    if (expected === hapResult) gtVsHapMatch++;
    if (expected === ourResult) gtVsOursMatch++;
    if (hapResult === ourResult) hapVsOursMatch++;

    // TP/FP/FN/TN for HapFlow original
    if (expected > 0 && hapResult > 0) { const min = Math.min(expected, hapResult); tp_hap += min; fp_hap += Math.max(0, hapResult - expected); fn_hap += Math.max(0, expected - hapResult); }
    else if (expected > 0 && hapResult === 0) fn_hap += expected;
    else if (expected === 0 && hapResult > 0) fp_hap += hapResult;
    else tn_hap++;

    // TP/FP/FN/TN for our results
    if (expected > 0 && ourResult > 0) { const min = Math.min(expected, ourResult); tp_ours += min; fp_ours += Math.max(0, ourResult - expected); fn_ours += Math.max(0, expected - ourResult); }
    else if (expected > 0 && ourResult === 0) fn_ours += expected;
    else if (expected === 0 && ourResult > 0) fp_ours += ourResult;
    else tn_ours++;

    const mismatch = expected !== ourResult;
    if (mismatch || hapResult !== ourResult) {
        console.log(`${name.padEnd(55)} ${String(expected).padStart(4)} ${String(hapResult).padStart(8)} ${String(ourResult).padStart(9)}${mismatch ? ' *' : ''}`);
    }
}

console.log('\n' + '='.repeat(80));
console.log(`Total: ${total}`);
console.log(``);
console.log(`HapFlow original vs GT: ${gtVsHapMatch}/${total} exact match (${(gtVsHapMatch/total*100).toFixed(1)}%)`);
console.log(`  TP=${tp_hap}, FP=${fp_hap}, FN=${fn_hap}, TN=${tn_hap}`);
const prec_hap = tp_hap + fp_hap > 0 ? (tp_hap / (tp_hap + fp_hap) * 100).toFixed(1) : 'N/A';
const rec_hap = tp_hap + fn_hap > 0 ? (tp_hap / (tp_hap + fn_hap) * 100).toFixed(1) : 'N/A';
console.log(`  Precision: ${prec_hap}%, Recall: ${rec_hap}%`);
console.log(``);
console.log(`ArkPrism vs GT: ${gtVsOursMatch}/${total} exact match (${(gtVsOursMatch/total*100).toFixed(1)}%)`);
console.log(`  TP=${tp_ours}, FP=${fp_ours}, FN=${fn_ours}, TN=${tn_ours}`);
const prec_ours = tp_ours + fp_ours > 0 ? (tp_ours / (tp_ours + fp_ours) * 100).toFixed(1) : 'N/A';
const rec_ours = tp_ours + fn_ours > 0 ? (tp_ours / (tp_ours + fn_ours) * 100).toFixed(1) : 'N/A';
console.log(`  Precision: ${prec_ours}%, Recall: ${rec_ours}%`);
console.log(``);
console.log(`HapFlow vs ArkPrism agreement: ${hapVsOursMatch}/${total} (${(hapVsOursMatch/total*100).toFixed(1)}%)`);
