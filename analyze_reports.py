#!/usr/bin/env python3
"""Comprehensive analysis of ArkPrism output reports"""
import json
import os
from pathlib import Path

def analyze_report(report_path):
    """Analyze a single report and return issues"""
    issues = []
    warnings = []

    try:
        with open(report_path, encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        return [f"JSON parse error: {e}"], []

    stats = data.get('statistics', {})
    apis = data.get('privacyApiUsages', [])
    chains = data.get('callChains', [])
    multi_src = data.get('multiSourceCollaborations', [])
    permissions = data.get('permissionUsages', [])

    # Issue 1: Permissions declared but no APIs detected
    if len(permissions) > 0 and stats.get('totalApisDetected', 0) == 0:
        issues.append(f"Has {len(permissions)} permissions but 0 APIs detected")

    # Issue 2: Chains without paths
    chains_no_path = [c for c in chains if not c.get('chain')]
    if chains_no_path:
        issues.append(f"{len(chains_no_path)} chains without call path")

    # Issue 3: Empty source snippets
    empty_snippets = sum(1 for c in chains if not c.get('sourceSnippets'))
    if empty_snippets > 0:
        warnings.append(f"{empty_snippets} chains with empty sourceSnippets")

    # Issue 4: Data sinks analysis
    total_sinks = sum(len(c.get('dataSinks', [])) for c in chains)

    # Issue 5: Check for %unk in method signatures (indicates unresolved types)
    unk_count = 0
    for api in apis:
        if '@%unk/%unk' in api.get('declaringMethod', ''):
            unk_count += 1
    if unk_count > 0:
        warnings.append(f"{unk_count} APIs have unresolved method signatures")

    # Issue 6: Check call chain completeness
    for c in chains:
        chain = c.get('chain', [])
        if chain:
            # Check if chain has entry
            if not c.get('entryMethod'):
                warnings.append(f"Chain {c.get('apiUsageIndex')} missing entryMethod")

    return issues, warnings

def main():
    out_dir = Path('out')

    print("=" * 80)
    print("ArkPrism Report Analysis Summary")
    print("=" * 80)

    all_issues = []
    all_warnings = []

    for sample_dir in sorted(out_dir.iterdir()):
        if not sample_dir.is_dir():
            continue

        report_files = list(sample_dir.glob("*-arkprism-report.json"))
        if not report_files:
            continue

        report_path = report_files[0]
        sample_name = sample_dir.name

        issues, warnings = analyze_report(report_path)

        with open(report_path, encoding='utf-8') as f:
            data = json.load(f)

        stats = data.get('statistics', {})

        print(f"\n{sample_name}:")
        print(f"  Files: {stats.get('totalFilesAnalyzed', 0)}, APIs: {stats.get('totalApisDetected', 0)}, "
              f"Chains: {stats.get('totalCallChainsBuilt', 0)}")

        if issues:
            print(f"  ISSUES:")
            for issue in issues:
                print(f"    - {issue}")
                all_issues.append(f"{sample_name}: {issue}")

        if warnings:
            print(f"  WARNINGS:")
            for warn in warnings:
                print(f"    - {warn}")
                all_warnings.append(f"{sample_name}: {warn}")

        if not issues and not warnings:
            print(f"  OK")

    print("\n" + "=" * 80)
    print(f"Summary: {len(all_issues)} issues, {len(all_warnings)} warnings across {len(list(out_dir.iterdir()))} samples")
    print("=" * 80)

    if all_issues:
        print("\nAll Issues:")
        for i, issue in enumerate(all_issues, 1):
            print(f"  {i}. {issue}")

if __name__ == "__main__":
    main()