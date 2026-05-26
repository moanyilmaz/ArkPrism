# ArkPrism

静态隐私分析工具，支持 HarmonyOS ArkTS 应用。

## 安装

```bash
npm install
```

## 使用

```bash
# 分析项目
npx ts-node src/arkprism.ts ./project

# 指定 SDK
npx ts-node src/arkprism.ts --sdkPath /sdk/path ./project

# 批量分析
npx ts-node src/arkprism.ts --batch ./dataset
```

## 选项

- `--sdkPath <path>` - OpenHarmony SDK 路径
- `--output-dir <path>` - 输出目录
- `--no-taint` - 跳过污点分析
- `--no-pta` - 跳过指针分析
- `--batch` - 批量模式

## 特性

- 隐私 API 检测
- 调用链追踪
- IFDS 污点分析
- 协同行为检测
- 权限声明提取

## MIT