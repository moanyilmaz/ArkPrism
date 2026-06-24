/**
 * 将 dot 图项目拆分为三个 zip 包 (每个 < 100KB)
 * 规则: A-F, G-M, N-Z
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OUTPUT_DIR = 'D:/argus-dataset/batch-results-1015-2026-06-10';
const TEMP_DIRS = [
    'D:/argus-dataset/dot-temp-1',
    'D:/argus-dataset/dot-temp-2',
    'D:/argus-dataset/dot-temp-3'
];
const ZIP_OUTPUTS = [
    'D:/argus-dataset/batch-results-1015-2026-06-10-dot-projects-part1.zip',
    'D:/argus-dataset/batch-results-1015-2026-06-10-dot-projects-part2.zip',
    'D:/argus-dataset/batch-results-1015-2026-06-10-dot-projects-part3.zip'
];

// 查找所有 dot 文件
const projectsWithDot = [];
function findDotFilesRecursive(dir, baseProjectName) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            findDotFilesRecursive(fullPath, baseProjectName);
        } else if (entry.name.endsWith('.dot')) {
            projectsWithDot.push({ projectName: baseProjectName, dotFile: entry.name, dotPath: fullPath });
        }
    }
}

console.log('查找 dot 图项目...');
const topEntries = fs.readdirSync(OUTPUT_DIR, { withFileTypes: true });
for (const entry of topEntries) {
    if (entry.isDirectory()) {
        findDotFilesRecursive(path.join(OUTPUT_DIR, entry.name), entry.name);
    }
}

// 按项目分组
const projectGroups = new Map();
for (const item of projectsWithDot) {
    if (!projectGroups.has(item.projectName)) {
        projectGroups.set(item.projectName, []);
    }
    projectGroups.get(item.projectName).push(item);
}

// 按字母分组: A-F, G-M, N-Z
const part1 = [], part2 = [], part3 = [];
for (const projectName of projectGroups.keys()) {
    const c = projectName.charAt(0).toUpperCase();
    if (c >= 'A' && c <= 'F') part1.push(projectName);
    else if (c >= 'G' && c <= 'M') part2.push(projectName);
    else part3.push(projectName);
}

part1.sort(); part2.sort(); part3.sort();
const parts = [part1, part2, part3];

console.log(`\nPart1 (A-F): ${part1.length} 个`);
console.log(`Part2 (G-M): ${part2.length} 个`);
console.log(`Part3 (N-Z): ${part3.length} 个`);

// 清理临时目录
for (const dir of TEMP_DIRS) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
    fs.mkdirSync(dir, { recursive: true });
}

// 复制
for (let i = 0; i < 3; i++) {
    console.log(`\n复制 Part${i+1}...`);
    for (const projectName of parts[i]) {
        const files = projectGroups.get(projectName);
        const projectDir = path.join(TEMP_DIRS[i], projectName);
        fs.mkdirSync(projectDir, { recursive: true });
        for (const file of files) {
            fs.copyFileSync(file.dotPath, path.join(projectDir, file.dotFile));
        }
    }
}

// 打包
console.log('\n打包...');
for (let i = 0; i < 3; i++) {
    try {
        execSync(`powershell -Command "Compress-Archive -Path '${TEMP_DIRS[i]}\\*' -DestinationPath '${ZIP_OUTPUTS[i]}' -Force"`, { encoding: 'utf8' });
        const stats = fs.statSync(ZIP_OUTPUTS[i]);
        console.log(`✓ Part${i+1}: ${(stats.size / 1024).toFixed(2)} KB`);
    } catch (e) {
        console.log(`✗ Part${i+1} 失败`);
    }
}

// 清理
for (const dir of TEMP_DIRS) {
    fs.rmSync(dir, { recursive: true });
}
console.log('\n完成');