/**
 * Batch Analysis Script for ARGUS 1080 HarmonyOS Samples
 * Uses source files (.ets) directly
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration - ARGUS dataset
const DATASET_DIR = 'D:/argus-dataset/ARGUS-dataset-all-1080-with-results-20260528/ARGUS-archive-bundle-20260528/dataset_all';
const OUTPUT_DIR = 'D:/argus-dataset/batch-results-arkprism-2026-06-01';
const MEMORY_LIMIT = '--max-old-space-size=4096';

// Statistics
const stats = {
    total: 0,
    success: 0,
    failed: 0,
    oom: 0,
    error: 0,
    skipped: 0,
    byCategory: {},
    totalTaintFlows: 0,
    totalApis: 0,
    projects: []
};

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Get all project directories
function getProjectDirs() {
    const dirs = [];
    const entries = fs.readdirSync(DATASET_DIR, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            dirs.push(entry.name);
        }
    }
    return dirs.sort();
}

// Find ets source directory for a project
function findEtsDir(projectPath) {
    // Try common paths
    const possiblePaths = [
        path.join(projectPath, 'entry/src/main/ets'),
        path.join(projectPath, 'entry/src/main'),
        path.join(projectPath, 'ets'),
        path.join(projectPath, 'src'),
        projectPath // Use project root if no specific path
    ];

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            // Check if it has ets files
            try {
                const files = getEtsFiles(p);
                if (files.length > 0) {
                    return p;
                }
            } catch (e) {
                // Continue to next path
            }
        }
    }
    return null;
}

// Get ets files recursively
function getEtsFiles(dir) {
    const files = [];
    try {
        function traverse(d) {
            const entries = fs.readdirSync(d, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(d, entry.name);
                if (entry.isDirectory()) {
                    // Skip build/cache directories
                    if (!entry.name.includes('build') && !entry.name.includes('cache') &&
                        !entry.name.includes('node_modules') && !entry.name.includes('.preview')) {
                        traverse(fullPath);
                    }
                } else if (entry.name.endsWith('.ets') || entry.name.endsWith('.ts')) {
                    files.push(fullPath);
                }
            }
        }
        traverse(dir);
    } catch (e) {
        // Ignore errors
    }
    return files;
}

// Run analysis on a single project
function analyzeProject(projectName) {
    const projectPath = path.join(DATASET_DIR, projectName);
    const outputPath = path.join(OUTPUT_DIR, projectName);

    // Check if project directory exists
    if (!fs.existsSync(projectPath)) {
        return { status: 'skipped', reason: 'directory not found' };
    }

    // Find ets source directory
    const etsDir = findEtsDir(projectPath);
    if (!etsDir) {
        return { status: 'skipped', reason: 'no ets source files' };
    }

    // Count source files
    const sourceFiles = getEtsFiles(etsDir);
    if (sourceFiles.length === 0) {
        return { status: 'skipped', reason: 'no ets files found' };
    }

    // Create output directory
    if (!fs.existsSync(outputPath)) {
        fs.mkdirSync(outputPath, { recursive: true });
    }

    try {
        const startTime = Date.now();

        // Run ArkPrism on the project root directory (not ets subdirectory)
        // This is required because build-profile.json5 uses relative paths
        const cmd = `node ${MEMORY_LIMIT} dist/arkprism.js "${projectPath}" --output-dir "${outputPath}"`;
        execSync(cmd, { encoding: 'utf8', timeout: 300000 });

        const duration = Date.now() - startTime;

        // Parse report if exists
        // Report is at: outputPath/projectName/projectName-arkprism-report.json
        const reportInProjectDir = path.join(outputPath, projectName, `${projectName}-arkprism-report.json`);

        let report = null;
        let reportPath = null;

        // Check the project subdirectory first
        if (fs.existsSync(reportInProjectDir)) {
            reportPath = reportInProjectDir;
        }

        // Fallback: search for any report file in project subdirectory
        if (!reportPath && fs.existsSync(path.join(outputPath, projectName))) {
            const projectOutputFiles = fs.readdirSync(path.join(outputPath, projectName));
            for (const f of projectOutputFiles) {
                if (f.endsWith('-arkprism-report.json')) {
                    reportPath = path.join(outputPath, projectName, f);
                    break;
                }
            }
        }

        if (reportPath && fs.existsSync(reportPath)) {
            report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
        }

        if (report) {
            const apiCount = report.privacyApiUsages?.length || 0;
            const taintFlowCount = report.callChains?.filter(c => c.dataSinks?.length > 0).length || 0;

            // Merge category stats
            for (const chain of report.callChains || []) {
                const api = report.privacyApiUsages[chain.apiUsageIndex];
                if (api && api.profilingCategory) {
                    stats.byCategory[api.profilingCategory] = (stats.byCategory[api.profilingCategory] || 0) + 1;
                }
            }

            return {
                status: 'success',
                duration,
                chainCount: report.callChains?.length || 0,
                apiCount,
                taintFlowCount
            };
        }

        return { status: 'success', duration };
    } catch (error) {
        const errorMsg = error.message || error.toString();

        if (errorMsg.includes('FATAL ERROR') && errorMsg.includes('OOM')) {
            return { status: 'oom' };
        }

        return { status: 'error', error: errorMsg.substring(0, 200) };
    }
}

// Save statistics
function saveStats() {
    const statsPath = path.join(OUTPUT_DIR, 'statistics.json');
    fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
}

// Main analysis loop
function runBatchAnalysis() {
    console.log('='.repeat(70));
    console.log('ArkPrism Batch Analysis - ARGUS 1080 Samples');
    console.log('='.repeat(70));
    console.log('');

    const projects = getProjectDirs();
    stats.total = projects.length;
    console.log(`Found ${projects.length} projects`);
    console.log(`Source directory: ${DATASET_DIR}`);
    console.log(`Output directory: ${OUTPUT_DIR}`);
    console.log('');

    for (let i = 0; i < projects.length; i++) {
        const projectName = projects[i];
        const progress = `[${i + 1}/${projects.length}]`;

        process.stdout.write(`${progress} ${projectName}... `);

        const result = analyzeProject(projectName);

        if (result.status === 'success') {
            stats.success++;
            stats.totalApis += result.apiCount || 0;
            stats.totalTaintFlows += result.taintFlowCount || 0;

            stats.projects.push({
                name: projectName,
                status: 'success',
                apiCount: result.apiCount,
                chainCount: result.chainCount,
                taintFlowCount: result.taintFlowCount,
                duration: result.duration
            });

            console.log(`OK (${result.apiCount} APIs, ${result.taintFlowCount} flows, ${result.duration}ms)`);
        } else if (result.status === 'oom') {
            stats.oom++;
            stats.projects.push({ name: projectName, status: 'oom' });
            console.log('OOM');
        } else if (result.status === 'skipped') {
            stats.skipped++;
            stats.projects.push({ name: projectName, status: 'skipped', reason: result.reason });
            console.log(`SKIP (${result.reason})`);
        } else if (result.status === 'error') {
            stats.error++;
            stats.projects.push({ name: projectName, status: 'error', error: result.error });
            console.log(`ERROR`);
        }

        // Save intermediate stats every 100 projects
        if ((i + 1) % 100 === 0) {
            saveStats();
            console.log('');
            console.log(`--- Progress: ${i + 1}/${projects.length} ---`);
        }
    }

    console.log('');
    console.log('='.repeat(70));
    console.log('Analysis Complete');
    console.log('='.repeat(70));

    // Final statistics
    console.log('');
    console.log('=== Summary Statistics ===');
    console.log(`Total projects: ${stats.total}`);
    console.log(`Successful: ${stats.success} (${(stats.success / stats.total * 100).toFixed(1)}%)`);
    console.log(`Failed (OOM): ${stats.oom} (${(stats.oom / stats.total * 100).toFixed(1)}%)`);
    console.log(`Failed (Error): ${stats.error} (${(stats.error / stats.total * 100).toFixed(1)}%)`);
    console.log(`Skipped: ${stats.skipped} (${(stats.skipped / stats.total * 100).toFixed(1)}%)`);
    console.log('');
    console.log(`Total APIs detected: ${stats.totalApis}`);
    console.log(`Total taint flows: ${stats.totalTaintFlows}`);
    console.log(`Average taint flows per project: ${(stats.totalTaintFlows / Math.max(stats.success, 1)).toFixed(2)}`);
    console.log('');

    console.log('=== Category Distribution ===');
    const sortedCategories = Object.entries(stats.byCategory)
        .sort((a, b) => b[1] - a[1]);
    for (const [cat, count] of sortedCategories.slice(0, 20)) {
        console.log(`  ${cat}: ${count}`);
    }

    saveStats();
    return stats;
}

// Run if executed directly
runBatchAnalysis();