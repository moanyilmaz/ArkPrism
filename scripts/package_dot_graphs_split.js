/**
 * 任务: 将 dot 图项目拆分为两个 zip 包 (按字母顺序 A-M, N-Z)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OUTPUT_DIR = 'D:/argus-dataset/batch-results-1015-2026-06-10';
const TEMP_DIR_PART1 = 'D:/argus-dataset/dot-projects-temp-part1';
const TEMP_DIR_PART2 = 'D:/argus-dataset/dot-projects-temp-part2';
const ZIP_OUTPUT_PART1 = 'D:/argus-dataset/batch-results-1015-2026-06-10-dot-projects-part1.zip';
const ZIP_OUTPUT_PART2 = 'D:/argus-dataset/batch-results-1015-2026-06-10-dot-projects-part2.zip';

// 查找所有 dot 文件
const projectsWithDot = [];

function findDotFilesRecursive(dir, baseProjectName) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            findDotFilesRecursive(fullPath, baseProjectName);
        } else if (entry.name.endsWith('.dot')) {
            projectsWithDot.push({
                projectName: baseProjectName,
                dotFile: entry.name,
                dotPath: fullPath
            });
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

console.log(`找到 ${projectsWithDot.length} 个 dot 文件`);

// 按项目分组
const projectGroups = new Map();
for (const item of projectsWithDot) {
    if (!projectGroups.has(item.projectName)) {
        projectGroups.set(item.projectName, []);
    }
    projectGroups.get(item.projectName).push(item);
}

// 按首字母分组
const part1Projects = [];
const part2Projects = [];

for (const projectName of projectGroups.keys()) {
    const firstChar = projectName.charAt(0).toUpperCase();
    if (firstChar >= 'A' && firstChar <= 'M') {
        part1Projects.push(projectName);
    } else {
        part2Projects.push(projectName);
    }
}

// 排序
part1Projects.sort();
part2Projects.sort();

console.log(`\nPart1 (A-M): ${part1Projects.length} 个项目`);
console.log(`Part2 (N-Z): ${part2Projects.length} 个项目`);

// 清理旧目录
[TEMP_DIR_PART1, TEMP_DIR_PART2].forEach(dir => {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true });
    }
    fs.mkdirSync(dir, { recursive: true });
});

// 复制 Part1
function copyProjects(projectNames, targetDir) {
    for (const projectName of projectNames) {
        const files = projectGroups.get(projectName);
        const projectDir = path.join(targetDir, projectName);
        fs.mkdirSync(projectDir, { recursive: true });
        for (const file of files) {
            fs.copyFileSync(file.dotPath, path.join(projectDir, file.dotFile));
        }
    }
}

console.log('\n复制 Part1...');
copyProjects(part1Projects, TEMP_DIR_PART1);

console.log('复制 Part2...');
copyProjects(part2Projects, TEMP_DIR_PART2);

// 打包
function createZip(sourceDir, outputPath) {
    try {
        const parentDir = path.dirname(sourceDir);
        const baseName = path.basename(sourceDir);
        execSync(`powershell -Command "Compress-Archive -Path '${sourceDir}\\*' -DestinationPath '${outputPath}' -Force"`, {
            encoding: 'utf8',
            cwd: parentDir
        });
        const stats = fs.statSync(outputPath);
        console.log(`打包完成: ${path.basename(outputPath)} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    } catch (e) {
        console.log('打包失败:', e.message);
    }
}

console.log('\n打包 Part1...');
createZip(TEMP_DIR_PART1, ZIP_OUTPUT_PART1);

console.log('打包 Part2...');
createZip(TEMP_DIR_PART2, ZIP_OUTPUT_PART2);

// 清理临时目录
fs.rmSync(TEMP_DIR_PART1, { recursive: true });
fs.rmSync(TEMP_DIR_PART2, { recursive: true });
console.log('\n临时目录已清理');

// 列出包含的项目
console.log('\n=== Part1 (A-M) ===');
part1Projects.forEach(name => console.log(`  ${name}`));

console.log('\n=== Part2 (N-Z) ===');
part2Projects.forEach(name => console.log(`  ${name}`));