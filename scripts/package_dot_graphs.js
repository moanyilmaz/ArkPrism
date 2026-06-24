/**
 * 任务2: 筛选有 dot 图结果的项目，打包 zip
 * 目录结构: OUTPUT_DIR/projectName/projectName/xxx-privacy-graph.dot
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OUTPUT_DIR = 'D:/argus-dataset/batch-results-1015-2026-06-10';
const TEMP_DIR = 'D:/argus-dataset/dot-projects-temp-v1';
const ZIP_OUTPUT = 'D:/argus-dataset/batch-results-1015-2026-06-10-dot-projects.zip';

// 确保临时目录存在
if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true });
}
fs.mkdirSync(TEMP_DIR, { recursive: true });

// 查找所有 dot 文件 (递归搜索)
const projectsWithDot = [];
let totalDotFiles = 0;

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
            totalDotFiles++;
        }
    }
}

// 遍历顶层目录
console.log('查找有 dot 图的项目...');
const topEntries = fs.readdirSync(OUTPUT_DIR, { withFileTypes: true });
for (const entry of topEntries) {
    if (entry.isDirectory()) {
        const projectPath = path.join(OUTPUT_DIR, entry.name);
        findDotFilesRecursive(projectPath, entry.name);
    }
}

console.log(`\n找到 ${projectsWithDot.length} 个 dot 文件`);

// 按项目分组
const projectGroups = new Map();
for (const item of projectsWithDot) {
    if (!projectGroups.has(item.projectName)) {
        projectGroups.set(item.projectName, []);
    }
    projectGroups.get(item.projectName).push(item);
}

console.log(`涉及 ${projectGroups.size} 个项目`);

// 复制到临时目录并打包
console.log('\n复制项目到临时目录...');
for (const [projectName, files] of projectGroups) {
    const targetDir = path.join(TEMP_DIR, projectName);
    fs.mkdirSync(targetDir, { recursive: true });

    for (const file of files) {
        const dst = path.join(targetDir, file.dotFile);
        fs.copyFileSync(file.dotPath, dst);
    }
}

// 打包 zip
console.log('\n打包 zip...');
try {
    // 使用 PowerShell 打包
    const parentDir = path.dirname(TEMP_DIR);
    const tempBase = path.basename(TEMP_DIR);

    execSync(`powershell -Command "Compress-Archive -Path '${TEMP_DIR}\\*' -DestinationPath '${ZIP_OUTPUT}' -Force"`, {
        encoding: 'utf8',
        cwd: parentDir
    });

    console.log(`\n打包完成: ${ZIP_OUTPUT}`);

    // 显示 zip 大小
    const stats = fs.statSync(ZIP_OUTPUT);
    console.log(`文件大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`包含: ${projectGroups.size} 个项目, ${totalDotFiles} 个 dot 文件`);
} catch (e) {
    console.log('打包失败:', e.message);
}

// 清理临时目录
fs.rmSync(TEMP_DIR, { recursive: true });
console.log('临时目录已清理');

// 显示包含的项目列表
console.log('\n=== 包含的项目列表 ===');
for (const [projectName, files] of projectGroups) {
    console.log(`  ${projectName}: ${files.map(f => f.dotFile).join(', ')}`);
}