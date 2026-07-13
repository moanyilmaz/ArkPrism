/**
 * Compare: HapFlow original vs our native config vs ground truth
 */
const fs = require('fs');

// Parse HapFlow original results
const benchOutput = fs.readFileSync('D:/Projects/Argus-0703/hapflow_artifact/hapflow/out/BenchOutput.txt', 'utf-8');
const benchResults = new Map();
for (const line of benchOutput.trim().split('\n')) {
    const parts = line.split(' , ');
    if (parts.length === 2) {
        const name = parts[0].replace('..\\HapBench\\', '').replace(/\\/g, '/');
        benchResults.set(name, parseInt(parts[1].trim()));
    }
}

// Parse our native config results
const ourResults = JSON.parse(fs.readFileSync('D:/Projects/Argus-0703/ArkPrism/docs/comparison_hapflow_vs_arkprism/hapbench_native_validation.json', 'utf-8'));

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

// Show only cases where HapFlow original differs from our native config
console.log(`${'Test'.padEnd(55)} ${'GT'.padStart(4)} ${'HapFlow'.padStart(8)} ${'Ours'.padStart(5)}`);
console.log('-'.repeat(80));
for (const [name, expected] of groundTruth) {
    const hapResult = benchResults.get(name) ?? -1;
    const ourResult = ourResults.results.find(r => r.name === name)?.actual ?? -1;
    if (hapResult !== ourResult) {
        console.log(`${name.padEnd(55)} ${String(expected).padStart(4)} ${String(hapResult).padStart(8)} ${String(ourResult).padStart(5)}`);
    }
}
