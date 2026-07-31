"""Generate the evaluation figures from the audited ArkPrism results.

The paper-facing entry point derives every plotted corpus value from one
validated final run. It also emits the plotted values and run hashes as JSON
so the figure can be audited independently.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import matplotlib as mpl
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import PathPatch, Rectangle
from matplotlib.path import Path as MplPath


PAPER_ROOT = Path(__file__).resolve().parents[1]
FIG_DIR = PAPER_ROOT / "figs"
OUT_JSON = PAPER_ROOT / "data" / "evaluation_figure_summary.json"

DETECTOR_ORDER = [
    "direct invoke stmt",
    "direct invoke stmt after assignment",
    "indirect invoke",
    "privacy constants",
]
SINK_ORDER = ["log", "ui_display", "storage", "data_return", "network"]

COLORS = {
    "blue": "#3B6EA8",
    "green": "#3D8B67",
    "purple": "#7561B5",
    "orange": "#D7863B",
    "red": "#C95D63",
    "gray": "#C9D3DF",
    "dark_gray": "#52606D",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    reports_dir = os.environ.get("ARKPRISM_REPORTS_DIR")
    parser.add_argument(
        "--reports-dir",
        type=Path,
        default=Path(reports_dir) if reports_dir else None,
        required=reports_dir is None,
        help=(
            "Validated single-run report directory. May also be supplied "
            "through ARKPRISM_REPORTS_DIR."
        ),
    )
    return parser.parse_args()


def configure_style() -> None:
    mpl.rcParams.update(
        {
            "font.family": "DejaVu Sans",
            "font.size": 7.0,
            "axes.titlesize": 7.5,
            "axes.labelsize": 6.8,
            "axes.linewidth": 0.7,
            "xtick.labelsize": 6.2,
            "ytick.labelsize": 6.2,
            "legend.fontsize": 5.8,
            "legend.frameon": False,
            "pdf.fonttype": 42,
            "ps.fonttype": 42,
            "savefig.transparent": False,
        }
    )


def wilson_interval(
    successes: int,
    total: int,
    z: float = 1.959963984540054,
) -> tuple[float, float]:
    if total <= 0:
        return (0.0, 0.0)
    proportion = successes / total
    denominator = 1.0 + z**2 / total
    center = (proportion + z**2 / (2.0 * total)) / denominator
    radius = (
        z
        * np.sqrt(
            proportion * (1.0 - proportion) / total
            + z**2 / (4.0 * total**2)
        )
        / denominator
    )
    return (
        float(max(0.0, center - radius)),
        float(min(1.0, center + radius)),
    )


def spearman_rho(left: np.ndarray, right: np.ndarray) -> float:
    """Compute Spearman's rho with average ranks for tied observations."""

    def average_ranks(values: np.ndarray) -> np.ndarray:
        order = np.argsort(values, kind="stable")
        ranks = np.empty(len(values), dtype=float)
        start = 0
        while start < len(values):
            end = start + 1
            while end < len(values) and values[order[end]] == values[order[start]]:
                end += 1
            ranks[order[start:end]] = (start + end - 1) / 2.0 + 1.0
            start = end
        return ranks

    left_ranks = average_ranks(np.asarray(left))
    right_ranks = average_ranks(np.asarray(right))
    if np.std(left_ranks) == 0 or np.std(right_ranks) == 0:
        return 0.0
    return float(np.corrcoef(left_ranks, right_ranks)[0, 1])


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_report_map(reports_dir: Path) -> dict[str, dict[str, Any]]:
    paths = sorted(reports_dir.glob("*/*-arkprism-report.json"))
    if not paths:
        raise FileNotFoundError(f"No ArkPrism reports found under {reports_dir}")
    reports = [load_json(path) for path in paths]
    return {str(report["projectName"]): report for report in reports}


def normalized_occurrence_part(value: Any) -> str:
    return str(value or "").replace("\\", "/").strip().lower()


def occurrence_key(usage: dict[str, Any]) -> tuple[str, ...]:
    return (
        normalized_occurrence_part(usage.get("apiPackage")),
        normalized_occurrence_part(usage.get("namespace")),
        normalized_occurrence_part(usage.get("method")),
        normalized_occurrence_part(usage.get("file")),
        normalized_occurrence_part(usage.get("declaringMethod")),
        str(usage.get("code", "")).strip(),
    )


def evidence_strength(usage: dict[str, Any]) -> int:
    return {
        "namespace": 1,
        "receiver_origin": 2,
        "target_signature": 3,
        "receiver_type": 4,
    }.get(usage.get("matchEvidence"), 5)


def canonical_detector_records(
    report: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    selected: dict[tuple[str, ...], tuple[int, dict[str, Any]]] = {}
    for index, usage in enumerate(report.get("privacyApiUsages", []) or []):
        key = occurrence_key(usage)
        current = selected.get(key)
        if current is None or evidence_strength(usage) > evidence_strength(
            current[1]
        ):
            selected[key] = (index, usage)

    ordered = sorted(selected.values(), key=lambda item: item[0])
    old_to_new = {
        old_index: new_index
        for new_index, (old_index, _) in enumerate(ordered)
    }
    chains = []
    for chain in report.get("callChains", []) or []:
        old_index = chain.get("apiUsageIndex")
        if old_index not in old_to_new:
            continue
        canonical_chain = dict(chain)
        canonical_chain["apiUsageIndex"] = old_to_new[old_index]
        chains.append(canonical_chain)
    return [usage for _, usage in ordered], chains


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_single_run_reports(
    reports_dir: Path,
) -> tuple[list[dict[str, Any]], dict[str, Any], Path]:
    manifest_path = reports_dir / "run_manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(
            f"Missing single-run manifest: {manifest_path}"
        )
    manifest = load_json(manifest_path)
    if manifest.get("status") != "complete":
        raise ValueError(
            f"Run manifest is not complete: {manifest.get('status')}"
        )
    progress = manifest.get("progress", {})
    inputs = manifest.get("inputs", {})
    if progress.get("errors") != 0:
        raise ValueError("Run manifest contains project errors")
    if manifest.get("execution", {}).get("resume"):
        raise ValueError("Release figures require a non-resumed single run")

    base = load_report_map(reports_dir)
    expected = inputs.get("projectCount")
    if expected != len(base) or progress.get("completed") != len(base):
        raise ValueError(
            "Manifest/report mismatch: "
            f"expected={expected}, completed={progress.get('completed')}, "
            f"reports={len(base)}"
        )

    reports = []
    for project, base_report in sorted(base.items()):
        usages, chains = canonical_detector_records(base_report)
        composite = dict(base_report)
        composite["privacyApiUsages"] = usages
        composite["callChains"] = chains
        reports.append(composite)
    return reports, manifest, manifest_path


def short_detector(label: str) -> str:
    return {
        "direct invoke stmt": "direct",
        "direct invoke stmt after assignment": "assigned",
        "indirect invoke": "manager",
        "privacy constants": "property",
    }.get(label, label.replace("_", " "))


def compact_category(label: str) -> str:
    return {
        "device_identity.screen": "screen",
        "device_identity.hardware": "hardware",
        "device_identity.biometric": "biometric",
        "network.connectivity": "net. conn.",
        "user_data.account": "account",
        "user_data.clipboard": "clipboard",
        "location": "location",
        "network.bluetooth": "bluetooth",
        "device_status.sensor": "sensor",
        "network.wifi": "Wi-Fi",
        "device_identity.software": "software",
        "user_data.media": "media",
        "media.camera": "camera",
        "device_status.audio": "audio",
    }.get(label, label.replace("_", "."))


def flow_source_scope(flow: dict[str, Any]) -> str:
    files = [
        flow.get("sourceFile"),
        flow.get("sinkFile"),
        *[item.get("file") for item in flow.get("path", []) or []],
    ]
    normalized = [
        str(value).replace("\\", "/").lower()
        for value in files
        if value
    ]
    if any("/ohostest/" in f"/{value.strip('/')}/" for value in normalized):
        return "test"
    if any(
        "/build/" in f"/{value.strip('/')}/"
        or "/.preview/" in f"/{value.strip('/')}/"
        or "/cache/" in f"/{value.strip('/')}/"
        for value in normalized
    ):
        return "generated"
    return "production"


def heatmap_text(
    ax: plt.Axes, matrix: np.ndarray, threshold_ratio: float = 0.55
) -> None:
    threshold = matrix.max() * threshold_ratio if matrix.size else 0
    for row in range(matrix.shape[0]):
        for col in range(matrix.shape[1]):
            value = int(matrix[row, col])
            if value:
                ax.text(
                    col,
                    row,
                    str(value),
                    ha="center",
                    va="center",
                    fontsize=5.7,
                    color="white" if value >= threshold else "#17202A",
                )


def draw_alluvial(
    ax: plt.Axes,
    levels: list[list[str]],
    links: list[dict[tuple[str, str], int]],
    level_labels: list[str],
    node_colors: list[dict[str, str]],
) -> None:
    gap = 0.025
    block_width = 0.055
    available_height = 0.90
    x_positions = [0.04, 0.49, 0.94]
    node_bounds: list[dict[str, tuple[float, float]]] = []

    for level_index, nodes in enumerate(levels):
        if level_index == 0:
            totals = Counter()
            for (source, _), count in links[0].items():
                totals[source] += count
        else:
            totals = Counter()
            for (_, target), count in links[level_index - 1].items():
                totals[target] += count

        total = sum(totals.values())
        scale = (
            available_height - gap * (len(nodes) - 1)
        ) / max(1, total)
        cursor = available_height
        bounds: dict[str, tuple[float, float]] = {}
        for node in nodes:
            height = totals[node] * scale
            bounds[node] = (cursor - height, cursor)
            cursor -= height + gap
        node_bounds.append(bounds)

    for link_index, link_counts in enumerate(links):
        left_x = x_positions[link_index] + block_width
        right_x = x_positions[link_index + 1]
        source_offsets = {
            node: node_bounds[link_index][node][0]
            for node in levels[link_index]
        }
        target_offsets = {
            node: node_bounds[link_index + 1][node][0]
            for node in levels[link_index + 1]
        }
        level_total = sum(link_counts.values())
        source_scale = (
            available_height
            - gap * (len(levels[link_index]) - 1)
        ) / max(1, level_total)
        target_scale = (
            available_height
            - gap * (len(levels[link_index + 1]) - 1)
        ) / max(1, level_total)
        level_scale = min(source_scale, target_scale)

        for source in levels[link_index]:
            for target in levels[link_index + 1]:
                count = link_counts.get((source, target), 0)
                if not count:
                    continue
                height = count * level_scale
                source_low = source_offsets[source]
                source_high = source_low + height
                target_low = target_offsets[target]
                target_high = target_low + height
                source_offsets[source] = source_high
                target_offsets[target] = target_high
                control = (right_x - left_x) * 0.44
                vertices = [
                    (left_x, source_low),
                    (left_x + control, source_low),
                    (right_x - control, target_low),
                    (right_x, target_low),
                    (right_x, target_high),
                    (right_x - control, target_high),
                    (left_x + control, source_high),
                    (left_x, source_high),
                    (left_x, source_low),
                ]
                codes = [
                    MplPath.MOVETO,
                    MplPath.CURVE4,
                    MplPath.CURVE4,
                    MplPath.CURVE4,
                    MplPath.LINETO,
                    MplPath.CURVE4,
                    MplPath.CURVE4,
                    MplPath.CURVE4,
                    MplPath.CLOSEPOLY,
                ]
                ax.add_patch(
                    PathPatch(
                        MplPath(vertices, codes),
                        facecolor=node_colors[link_index][source],
                        edgecolor="none",
                        alpha=0.34,
                        zorder=1,
                    )
                )

    for level_index, nodes in enumerate(levels):
        x_pos = x_positions[level_index]
        label_positions: dict[str, float] = {}
        previous = -0.04
        for node in reversed(nodes):
            low, high = node_bounds[level_index][node]
            position = max((low + high) / 2, previous + 0.090)
            label_positions[node] = position
            previous = position
        for node in nodes:
            low, high = node_bounds[level_index][node]
            ax.add_patch(
                Rectangle(
                    (x_pos, low),
                    block_width,
                    high - low,
                    facecolor=node_colors[level_index][node],
                    edgecolor="white",
                    linewidth=0.35,
                    zorder=3,
                )
            )
            label_x = (
                x_pos - 0.012
                if level_index == 0
                else x_pos + block_width + 0.012
            )
            label_y = label_positions[node]
            center_y = (low + high) / 2
            if abs(label_y - center_y) > 0.012:
                line_end = (
                    label_x + 0.004
                    if level_index == 0
                    else label_x - 0.004
                )
                ax.plot(
                    [
                        x_pos if level_index == 0 else x_pos + block_width,
                        line_end,
                    ],
                    [center_y, label_y],
                    color=COLORS["dark_gray"],
                    linewidth=0.35,
                    zorder=3,
                )
            ax.text(
                label_x,
                label_y,
                node,
                ha="right" if level_index == 0 else "left",
                va="center",
                fontsize=4.4,
                zorder=4,
            )
        ax.text(
            x_pos + block_width / 2,
            0.965,
            level_labels[level_index],
            ha="center",
            va="bottom",
            fontsize=5.4,
            fontweight="bold",
        )

    ax.set_xlim(-0.18, 1.18)
    ax.set_ylim(-0.04, 1.08)
    ax.axis("off")


def summarize_reports(
    reports: list[dict[str, Any]],
) -> dict[str, Any]:
    project_rows: list[dict[str, Any]] = []
    category_sink: defaultdict[str, Counter[str]] = defaultdict(Counter)
    category_detector: defaultdict[str, Counter[str]] = defaultdict(Counter)
    detector_chain: defaultdict[str, Counter[str]] = defaultdict(Counter)
    profiling_counter: Counter[str] = Counter()
    usage_feature_rows: list[dict[str, Any]] = []
    flow_rows: list[dict[str, Any]] = []

    for report in reports:
        usages = report.get("privacyApiUsages", []) or []
        chains = report.get("callChains", []) or []
        taints = report.get("taintFlows", []) or []
        stats = report.get("statistics", {}) or {}
        taint_sources = [str(flow.get("sourceApi", "")) for flow in taints]
        chain_by_usage = {
            chain.get("apiUsageIndex"): chain
            for chain in chains
            if isinstance(chain.get("apiUsageIndex"), int)
        }

        sink_count = 0
        for index, usage in enumerate(usages):
            detector = usage.get("category", "unknown")
            category = usage.get("profilingCategory", "unknown")
            chain = chain_by_usage.get(index, {})
            entry = chain.get("entryMethod", {})
            if isinstance(entry, dict):
                entry_type = entry.get("type", "unknown")
            else:
                entry_type = "unknown"
            data_sinks = chain.get("dataSinks", []) or []
            sink_count += len(data_sinks)
            method = str(usage.get("method", ""))
            has_taint = bool(method) and any(method in source for source in taint_sources)

            profiling_counter[category] += 1
            category_detector[category][detector] += 1
            detector_chain[detector][entry_type] += 1
            usage_feature_rows.append(
                {
                    "detector": detector,
                    "category": category,
                    "entry": entry_type,
                    "sinkCount": len(data_sinks),
                    "hasTaint": has_taint,
                }
            )
            for sink in data_sinks:
                category_sink[category][sink.get("sinkType", "unknown")] += 1

        project_rows.append(
            {
                "name": report.get("projectName"),
                "files": int(stats.get("totalFilesAnalyzed", 0)),
                "methods": int(stats.get("totalMethodsAnalyzed", 0)),
                "apis": len(usages),
                "sinks": sink_count,
                "taints": len(taints),
            }
        )
        for flow in taints:
            path = flow.get("path", []) or []
            derivations = sorted(
                {
                    str(item).strip().lower()
                    for item in (flow.get("analysisDerivations", []) or [])
                    if str(item).strip()
                }
            )
            flow_rows.append(
                {
                    "project": report.get("projectName"),
                    "sourceKind": flow.get("sourceKind", "unknown"),
                    "provenance": flow.get("provenance", "unknown"),
                    "analysisDerivations": derivations,
                    "sourceScope": flow_source_scope(flow),
                    "pathStatements": len(path),
                }
            )

    return {
        "projectRows": project_rows,
        "categorySink": category_sink,
        "categoryDetector": category_detector,
        "detectorChain": detector_chain,
        "profilingCounter": profiling_counter,
        "usageFeatureRows": usage_feature_rows,
        "flowRows": flow_rows,
    }


def summarize_manual(manual: dict[str, Any]) -> dict[str, Any]:
    samples = manual["samples"]
    annotations = manual["annotations"]
    benchmark = manual["benchmark"]

    keys_by_project: defaultdict[str, defaultdict[str, set[str]]] = defaultdict(
        lambda: defaultdict(set)
    )
    detector_counts: Counter[str] = Counter()
    evidence_counts: Counter[str] = Counter()
    evidence_detector: defaultdict[str, Counter[str]] = defaultdict(Counter)
    detector_category: defaultdict[str, Counter[str]] = defaultdict(Counter)
    evidence_detector_category: defaultdict[
        tuple[str, str], Counter[str]
    ] = defaultdict(Counter)
    evidence_flow_records: list[tuple[str, str, str]] = []

    for annotation in annotations:
        project = annotation["projectName"]
        api_key = annotation["api"]["key"]
        detector = annotation["toolEvidence"].get(
            "detectorCategory", "unknown"
        )
        evidence = annotation["manualAnnotation"].get(
            "evidenceKind", "unknown"
        )
        keys_by_project[project][api_key].add(detector)
        detector_counts[detector] += 1
        evidence_counts[evidence] += 1
        evidence_detector[evidence][detector] += 1
        profiling_category = annotation["toolEvidence"].get(
            "profilingCategory", "unknown"
        )
        detector_category[detector][profiling_category] += 1
        evidence_detector_category[(evidence, detector)][
            profiling_category
        ] += 1
        evidence_flow_records.append((evidence, detector, profiling_category))

    weighted_evidence_detector: defaultdict[
        tuple[str, str], float
    ] = defaultdict(float)
    weighted_detector_category: defaultdict[
        tuple[str, str], float
    ] = defaultdict(float)
    for evidence, detector, profiling_category in evidence_flow_records:
        weight = 1.0 / np.sqrt(max(1, evidence_counts[evidence]))
        weighted_evidence_detector[(evidence, detector)] += weight
        weighted_detector_category[(detector, profiling_category)] += weight

    baseline_defs = [
        ("direct stmt", {"direct invoke stmt"}),
        (
            "direct calls",
            {"direct invoke stmt", "direct invoke stmt after assignment"},
        ),
        (
            "+ manager",
            {
                "direct invoke stmt",
                "direct invoke stmt after assignment",
                "indirect invoke",
            },
        ),
    ]
    recalls: dict[str, list[float]] = {name: [] for name, _ in baseline_defs}
    covered_totals: dict[str, int] = {name: 0 for name, _ in baseline_defs}

    for sample in samples:
        project_keys = keys_by_project[sample["projectName"]]
        denominator = max(1, len(project_keys))
        for name, allowed in baseline_defs:
            covered = sum(
                1 for detectors in project_keys.values() if detectors & allowed
            )
            recalls[name].append(covered / denominator)
            covered_totals[name] += covered

    return {
        "benchmark": benchmark,
        "samples": samples,
        "keysByProject": keys_by_project,
        "detectorCounts": detector_counts,
        "evidenceCounts": evidence_counts,
        "evidenceDetector": evidence_detector,
        "detectorCategory": detector_category,
        "evidenceDetectorCategory": evidence_detector_category,
        "weightedEvidenceDetector": weighted_evidence_detector,
        "weightedDetectorCategory": weighted_detector_category,
        "baselineDefs": baseline_defs,
        "baselineRecall": recalls,
        "baselineCoveredTotals": covered_totals,
    }


def build_manual_figure(
    manual_summary: dict[str, Any],
    report_summary: dict[str, Any],
) -> dict[str, Any]:
    samples = sorted(
        manual_summary["samples"],
        key=lambda item: item["rankByDetectedApiUsages"],
    )
    project_lookup = {
        row["name"]: row for row in report_summary["projectRows"]
    }
    total_apis = sum(row["apis"] for row in report_summary["projectRows"])
    total_sinks = sum(row["sinks"] for row in report_summary["projectRows"])
    total_taints = sum(row["taints"] for row in report_summary["projectRows"])
    total_gold = manual_summary["benchmark"]["manualGoldApiMethods"]

    ranks = np.arange(1, len(samples) + 1)
    coverage_series = {}
    for field, denominator in [
        ("apiUsageAnnotations", total_apis),
        ("manualGoldApiMethods", total_gold),
    ]:
        coverage_series[field] = (
            np.cumsum([sample[field] for sample in samples])
            / max(1, denominator)
            * 100
        )
    coverage_series["dataSinks"] = (
        np.cumsum(
            [
                project_lookup.get(sample["projectName"], {}).get("sinks", 0)
                for sample in samples
            ]
        )
        / max(1, total_sinks)
        * 100
    )
    coverage_series["taintFlows"] = (
        np.cumsum(
            [
                project_lookup.get(sample["projectName"], {}).get("taints", 0)
                for sample in samples
            ]
        )
        / max(1, total_taints)
        * 100
    )

    fig, axes = plt.subplots(
        1,
        4,
        figsize=(7.15, 1.94),
        gridspec_kw={
            "width_ratios": [1.00, 0.82, 1.15, 1.65],
            "wspace": 0.40,
        },
    )

    ax = axes[0]
    for key, color, label in [
        ("apiUsageAnnotations", COLORS["blue"], "API usages"),
        ("dataSinks", COLORS["red"], "sinks"),
        ("taintFlows", COLORS["green"], "taint flows"),
        ("manualGoldApiMethods", COLORS["purple"], "gold methods"),
    ]:
        ax.plot(
            ranks,
            coverage_series[key],
            linewidth=1.45,
            color=color,
            label=label,
        )
    ax.set_xscale("log")
    ax.set_ylim(0, 105)
    ax.set_xlabel("Reviewed project rank (log)")
    ax.set_ylabel("Cumulative coverage (%)")
    ax.set_title("(a) Review coverage")
    ax.legend(loc="upper left", fontsize=5.0)

    ax = axes[1]
    baseline_names = [
        name for name, _ in manual_summary["baselineDefs"]
    ]
    violin_data = [
        [value * 100 for value in manual_summary["baselineRecall"][name]]
        for name in baseline_names
    ]
    parts = ax.violinplot(
        violin_data, showmeans=True, showextrema=False, widths=0.78
    )
    for body in parts["bodies"]:
        body.set_facecolor("#7CA6C2")
        body.set_edgecolor("#355C7D")
        body.set_alpha(0.65)
    parts["cmeans"].set_color("#1F2937")
    ax.set_xticks([1, 2, 3])
    ax.set_xticklabels(["D", "D+A", "D+A+M"])
    ax.set_xlabel("Cumulative detector stage")
    ax.set_ylim(0, 105)
    ax.set_ylabel("Project-level recall (%)")
    ax.set_title("(b) Baseline recall")
    global_recall = {}
    for index, name in enumerate(baseline_names, 1):
        value = (
            manual_summary["baselineCoveredTotals"][name]
            / max(1, total_gold)
            * 100
        )
        global_recall[name] = value
        ax.text(index, 102, f"{value:.0f}%", ha="center", va="top", fontsize=5.7)

    ax = axes[2]
    stage_defs = [
        ("D", {"direct invoke stmt"}),
        (
            "D+A",
            {"direct invoke stmt", "direct invoke stmt after assignment"},
        ),
        (
            "D+A+M",
            {
                "direct invoke stmt",
                "direct invoke stmt after assignment",
                "indirect invoke",
            },
        ),
        ("Full", set(DETECTOR_ORDER)),
    ]
    profile_matrix = []
    gold_sizes = []
    for sample in samples:
        project_keys = manual_summary["keysByProject"][sample["projectName"]]
        denominator = max(1, len(project_keys))
        profile_matrix.append(
            [
                sum(
                    1
                    for detectors in project_keys.values()
                    if detectors & allowed
                )
                / denominator
                * 100
                for _, allowed in stage_defs
            ]
        )
        gold_sizes.append(sample["manualGoldApiMethods"])
    profile_matrix_array = np.array(profile_matrix)
    gold_sizes_array = np.array(gold_sizes)
    quartile_ids = np.empty(len(samples), dtype=int)
    for quartile, indices in enumerate(
        np.array_split(np.argsort(gold_sizes_array, kind="stable"), 4)
    ):
        quartile_ids[indices] = quartile
    stage_x = np.arange(4)
    quartile_colors = [
        "#A6BDD7",
        COLORS["blue"],
        COLORS["green"],
        COLORS["purple"],
    ]
    profile_summary = {}
    for quartile, color in enumerate(quartile_colors):
        values = profile_matrix_array[quartile_ids == quartile]
        for project_values in values:
            ax.plot(
                stage_x,
                project_values,
                color=color,
                alpha=0.13,
                linewidth=0.45,
                zorder=1,
            )
        lower = np.percentile(values, 25, axis=0)
        median = np.median(values, axis=0)
        upper = np.percentile(values, 75, axis=0)
        ax.fill_between(
            stage_x,
            lower,
            upper,
            color=color,
            alpha=0.13,
            linewidth=0,
            zorder=2,
        )
        ax.plot(
            stage_x,
            median,
            color=color,
            marker="o",
            markersize=2.6,
            linewidth=1.25,
            label=f"Q{quartile + 1}",
            zorder=3,
        )
        profile_summary[f"goldSizeQ{quartile + 1}"] = {
            stage_defs[index][0]: {
                "medianRecall": float(median[index]),
                "q1Recall": float(lower[index]),
                "q3Recall": float(upper[index]),
            }
            for index in range(4)
        }
    ax.set_xticks(stage_x)
    ax.set_xticklabels([label for label, _ in stage_defs])
    ax.set_xlim(-0.12, 3.12)
    ax.set_ylim(0, 105)
    ax.set_ylabel("Project-level recall (%)")
    ax.set_xlabel("Cumulative detector stage")
    ax.set_title("(c) Recall recovery by project size")
    ax.grid(axis="y", color=COLORS["gray"], linewidth=0.35, alpha=0.55)
    ax.legend(
        title="Gold-size quartile",
        loc="lower right",
        ncol=2,
        fontsize=4.7,
        title_fontsize=4.8,
        handlelength=1.2,
        columnspacing=0.7,
        frameon=True,
        facecolor="white",
        framealpha=0.88,
        edgecolor="none",
    )

    ax = axes[3]
    evidence_order = [
        "namespace.method",
        "member.method",
        "template-expression",
        "qualified-compound-call",
    ]
    evidence_names = ["namespace", "member", "template", "compound"]
    evidence_labels = {
        evidence: name
        for evidence, name in zip(evidence_order, evidence_names)
    }
    detector_names = ["direct", "assigned", "manager", "property"]
    detector_labels = {
        detector: name
        for detector, name in zip(DETECTOR_ORDER, detector_names)
    }
    category_counter = Counter()
    for values in manual_summary["detectorCategory"].values():
        category_counter.update(values)
    top_categories = [name for name, _ in category_counter.most_common(4)]
    category_labels = {
        category: compact_category(category)
        for category in top_categories
    }
    other_label = "other"

    evidence_detector_links = {
        (evidence_labels[evidence], detector_labels[detector]): weight
        for (evidence, detector), weight in manual_summary[
            "weightedEvidenceDetector"
        ].items()
    }
    detector_category_links: defaultdict[
        tuple[str, str], float
    ] = defaultdict(float)
    for (detector, category), weight in manual_summary[
        "weightedDetectorCategory"
    ].items():
        target = (
            category_labels[category]
            if category in category_labels
            else other_label
        )
        detector_category_links[(detector_labels[detector], target)] += weight

    alluvial_colors = [
        dict(
            zip(
                [evidence_labels[item] for item in evidence_order],
                [
                    COLORS["blue"],
                    COLORS["purple"],
                    COLORS["orange"],
                    COLORS["green"],
                ],
            )
        ),
        dict(
            zip(
                [detector_labels[item] for item in DETECTOR_ORDER],
                [
                    COLORS["blue"],
                    COLORS["green"],
                    COLORS["purple"],
                    COLORS["orange"],
                ],
            )
        ),
        {
            **{
                category_labels[category]: color
                for category, color in zip(
                    top_categories,
                    [
                        COLORS["blue"],
                        COLORS["red"],
                        COLORS["green"],
                        COLORS["purple"],
                    ],
                )
            },
            other_label: COLORS["gray"],
        },
    ]
    draw_alluvial(
        ax,
        [
            [evidence_labels[item] for item in evidence_order],
            [detector_labels[item] for item in DETECTOR_ORDER],
            [category_labels[item] for item in top_categories] + [other_label],
        ],
        [dict(evidence_detector_links), dict(detector_category_links)],
        ["source form", "detector", "API category"],
        alluvial_colors,
    )
    ax.set_title("(d) Evidence attribution flows", pad=7)

    alluvial_summary = {
        "widthEncoding": (
            "Each annotation is weighted by "
            "1/sqrt(total annotations for its evidence form)."
        ),
        "rawEvidenceCounts": dict(manual_summary["evidenceCounts"]),
        "weightedEvidenceToDetector": {
            f"{source}->{target}": float(weight)
            for (source, target), weight in evidence_detector_links.items()
        },
        "weightedDetectorToCategory": {
            f"{source}->{target}": float(weight)
            for (source, target), weight in detector_category_links.items()
        },
    }

    fig.subplots_adjust(left=0.065, right=0.995, bottom=0.29, top=0.86)
    output = FIG_DIR / "eval_manual_benchmark_landscape.pdf"
    fig.savefig(output, bbox_inches="tight")
    plt.close(fig)

    return {
        "coverageAt120": {
            key: float(values[-1]) for key, values in coverage_series.items()
        },
        "globalBaselineRecall": global_recall,
        "detectorCounts": dict(manual_summary["detectorCounts"]),
        "evidenceCounts": dict(manual_summary["evidenceCounts"]),
        "projectCoverageProfiles": profile_summary,
        "evidenceAttributionFlows": alluvial_summary,
    }


def build_detection_figure(report_summary: dict[str, Any]) -> dict[str, Any]:
    project_rows = report_summary["projectRows"]
    top_categories = report_summary["profilingCounter"].most_common(8)
    category_order = [name for name, _ in top_categories]
    category_detector = report_summary["categoryDetector"]
    detector_chain = report_summary["detectorChain"]
    usage_rows = report_summary["usageFeatureRows"]

    category_matrix = np.array(
        [
            [category_detector[category].get(detector, 0) for detector in DETECTOR_ORDER]
            for category in category_order
        ],
        dtype=int,
    )
    entry_order = [
        "component_lifecycle",
        "app_lifecycle",
        "initialization",
        "unknown",
    ]
    chain_matrix = np.array(
        [
            [detector_chain[detector].get(entry, 0) for entry in entry_order]
            for detector in DETECTOR_ORDER
        ],
        dtype=int,
    )

    detector_counts = []
    sink_rates = []
    taint_rates = []
    for detector in DETECTOR_ORDER:
        rows = [row for row in usage_rows if row["detector"] == detector]
        detector_counts.append(len(rows))
        denominator = max(1, len(rows))
        sink_rates.append(
            sum(1 for row in rows if row["sinkCount"] > 0)
            / denominator
            * 100
        )
        taint_rates.append(
            sum(1 for row in rows if row["hasTaint"])
            / denominator
            * 100
        )

    buckets = [
        (0, 0, "0"),
        (1, 1, "1"),
        (2, 3, "2-3"),
        (4, 9, "4-9"),
        (10, 10**9, ">=10"),
    ]
    bucket_rows = []
    for low, high, _ in buckets:
        members = [
            row for row in project_rows if low <= row["apis"] <= high
        ]
        bucket_rows.append(
            [
                len(members),
                sum(1 for row in members if row["sinks"] > 0),
                sum(1 for row in members if row["taints"] > 0),
            ]
        )
    bucket_counts = np.array([row[0] for row in bucket_rows], dtype=float)
    bucket_sink_rates = (
        np.array([row[1] for row in bucket_rows])
        / np.maximum(bucket_counts, 1)
        * 100
    )
    bucket_taint_rates = (
        np.array([row[2] for row in bucket_rows])
        / np.maximum(bucket_counts, 1)
        * 100
    )

    fig, axes = plt.subplots(
        1,
        4,
        figsize=(7.15, 1.88),
        gridspec_kw={
            "width_ratios": [1.25, 1.0, 0.92, 1.08],
            "wspace": 0.58,
        },
    )

    ax = axes[0]
    ax.imshow(category_matrix, aspect="auto", cmap="Blues")
    ax.set_yticks(np.arange(len(category_order)))
    ax.set_yticklabels(
        [compact_category(name) for name in category_order],
        rotation=28,
        ha="right",
        rotation_mode="anchor",
    )
    ax.set_xticks(np.arange(4))
    ax.set_xticklabels(
        [short_detector(name) for name in DETECTOR_ORDER],
        rotation=28,
        ha="right",
    )
    ax.tick_params(axis="y", pad=0)
    ax.set_title("(a) Category x detector")
    heatmap_text(ax, category_matrix)

    ax = axes[1]
    ax.imshow(chain_matrix, aspect="auto", cmap="Oranges")
    ax.set_yticks(np.arange(4))
    ax.set_yticklabels(
        [short_detector(name) for name in DETECTOR_ORDER],
        rotation=28,
        ha="right",
        rotation_mode="anchor",
    )
    ax.set_xticks(np.arange(4))
    ax.set_xticklabels(["comp.", "app", "init", "unk."])
    ax.tick_params(axis="y", pad=0)
    ax.set_title("(b) Detector x chain")
    heatmap_text(ax, chain_matrix)

    ax = axes[2]
    x = np.arange(4)
    width = 0.34
    ax.bar(
        x - width / 2,
        sink_rates,
        width,
        color=COLORS["green"],
        alpha=0.82,
        label="sink",
    )
    ax.bar(
        x + width / 2,
        taint_rates,
        width,
        color=COLORS["purple"],
        alpha=0.78,
        label="taint",
    )
    ax.set_ylim(0, 100)
    ax.set_ylabel("Usages with evidence (%)")
    ax.set_xticks(x)
    ax.set_xticklabels(
        [short_detector(name) for name in DETECTOR_ORDER],
        rotation=28,
        ha="right",
    )
    ax.set_title("(c) Detector evidence")
    for index, count in enumerate(detector_counts):
        y = min(95, max(sink_rates[index], taint_rates[index]) + 4)
        ax.text(index, y, str(count), ha="center", va="bottom", fontsize=5.5)
    ax.legend(
        loc="upper right",
        ncol=2,
        borderaxespad=0.25,
        columnspacing=0.8,
    )

    ax = axes[3]
    x = np.arange(len(buckets))
    ax.bar(
        x,
        bucket_counts,
        color=COLORS["gray"],
        edgecolor=COLORS["dark_gray"],
        linewidth=0.45,
        label="projects",
    )
    ax.set_yscale("log")
    ax.set_xticks(x)
    ax.set_xticklabels([item[2] for item in buckets])
    ax.set_ylabel("Projects (log)")
    ax.set_xlabel("API usages per project")
    ax.set_title("(d) API-volume strata")
    twin = ax.twinx()
    twin.plot(
        x,
        bucket_sink_rates,
        color=COLORS["green"],
        marker="o",
        linewidth=1.0,
        markersize=2.8,
        label="sink",
    )
    twin.plot(
        x,
        bucket_taint_rates,
        color=COLORS["purple"],
        marker="s",
        linewidth=1.0,
        markersize=2.6,
        label="taint",
    )
    twin.set_ylim(0, 100)
    twin.set_ylabel("Projects with evidence (%)")
    handles, labels = ax.get_legend_handles_labels()
    twin_handles, twin_labels = twin.get_legend_handles_labels()
    twin.legend(
        handles + twin_handles,
        labels + twin_labels,
        loc="upper right",
        fontsize=5.1,
    )

    fig.subplots_adjust(left=0.095, right=0.965, bottom=0.30, top=0.84)
    output = FIG_DIR / "eval_detection_effectiveness.pdf"
    fig.savefig(output, bbox_inches="tight")
    plt.close(fig)

    return {
        "categoryOrder": category_order,
        "categoryDetectorMatrix": category_matrix.tolist(),
        "detectorChainMatrix": chain_matrix.tolist(),
        "detectorUsageCounts": detector_counts,
        "detectorSinkRates": sink_rates,
        "detectorTaintRates": taint_rates,
        "apiVolumeBuckets": {
            "labels": [item[2] for item in buckets],
            "projects": bucket_counts.astype(int).tolist(),
            "sinkRates": bucket_sink_rates.tolist(),
            "taintRates": bucket_taint_rates.tolist(),
        },
    }


def build_corpus_figure(report_summary: dict[str, Any]) -> dict[str, Any]:
    project_rows = report_summary["projectRows"]
    flow_rows = report_summary["flowRows"]
    category_sink = report_summary["categorySink"]
    categories = [
        name for name, _ in report_summary["profilingCounter"].most_common(10)
    ]
    matrix = np.array(
        [
            [category_sink[category].get(sink, 0) for sink in SINK_ORDER]
            for category in categories
        ],
        dtype=int,
    )

    sorted_projects = sorted(
        project_rows, key=lambda row: row["apis"], reverse=True
    )
    total_apis = sum(row["apis"] for row in sorted_projects)
    ranks = np.arange(1, len(sorted_projects) + 1)
    cumulative = (
        np.cumsum([row["apis"] for row in sorted_projects])
        / max(1, total_apis)
        * 100
    )
    methods = np.array([row["methods"] for row in project_rows])
    apis = np.array([row["apis"] for row in project_rows])
    sinks = np.array([row["sinks"] for row in project_rows])
    taints = np.array([row["taints"] for row in project_rows])

    method_order = np.argsort(methods, kind="stable")
    method_deciles = np.array_split(method_order, 10)
    evidence_arrays = {
        "api": apis,
        "sink": sinks,
        "path": taints,
    }
    size_strata = []
    for decile, indices in enumerate(method_deciles, start=1):
        stratum: dict[str, Any] = {
            "decile": decile,
            "projects": len(indices),
            "medianMethods": float(np.median(methods[indices])),
            "minMethods": int(np.min(methods[indices])),
            "maxMethods": int(np.max(methods[indices])),
        }
        for evidence_name, values in evidence_arrays.items():
            positives = int(np.count_nonzero(values[indices] > 0))
            lower, upper = wilson_interval(positives, len(indices))
            stratum[evidence_name] = {
                "positiveProjects": positives,
                "rate": positives / len(indices),
                "wilson95": [lower, upper],
            }
        size_strata.append(stratum)

    path_group_specs = [
        ("privacy_data", "ifds", "Privacy | IFDS", COLORS["blue"]),
        (
            "privacy_data",
            "async_supplement",
            "Privacy | Async",
            COLORS["purple"],
        ),
        ("privacy_data", "both", "Privacy | Dual", COLORS["green"]),
        (
            "framework_input",
            "ifds",
            "Framework | IFDS",
            COLORS["orange"],
        ),
    ]
    path_groups: dict[str, list[int]] = {}
    for source_kind, provenance, _, _ in path_group_specs:
        lengths = sorted(
            row["pathStatements"]
            for row in flow_rows
            if row["sourceKind"] == source_kind
            and row["provenance"] == provenance
            and row["pathStatements"] > 0
        )
        if lengths:
            path_groups[f"{source_kind}|{provenance}"] = lengths

    fig = plt.figure(figsize=(7.15, 2.05))
    grid = fig.add_gridspec(
        1,
        7,
        width_ratios=[0.62, 0.50, 0.92, 0.52, 1.48, 0.46, 1.29],
        wspace=0,
    )
    axes = [
        fig.add_subplot(grid[0, index])
        for index in [0, 2, 4, 6]
    ]

    ax = axes[0]
    ax.plot(ranks, cumulative, color=COLORS["green"], linewidth=1.8)
    ax.axvline(120, color=COLORS["purple"], linestyle="--", linewidth=0.9)
    ax.text(
        120,
        10,
        "Top-120",
        rotation=90,
        va="bottom",
        ha="right",
        fontsize=6.0,
        color=COLORS["purple"],
    )
    ax.set_xscale("log")
    ax.set_ylim(0, 105)
    ax.set_xlabel("Project rank (log scale)")
    ax.set_ylabel("Cumulative API usage share (%)")
    ax.set_title("(a) Long-tail concentration", fontsize=6.2)

    ax = axes[1]
    ax.imshow(matrix, aspect="auto", cmap="Blues")
    ax.set_yticks(np.arange(len(categories)))
    ax.set_yticklabels(
        [compact_category(name) for name in categories],
        rotation=34,
        ha="right",
        rotation_mode="anchor",
    )
    ax.tick_params(axis="y", pad=0, labelsize=5.6)
    ax.set_xticks(np.arange(len(SINK_ORDER)))
    ax.set_xticklabels(
        [name.replace("_", " ") for name in SINK_ORDER],
        rotation=28,
        ha="right",
    )
    ax.set_title("(b) Category x detector-local sinks", fontsize=6.2)
    heatmap_text(ax, matrix)

    ax = axes[2]
    decile_x = np.arange(1, len(size_strata) + 1)
    scale_series = [
        ("api", "API-positive", COLORS["blue"], "o", -0.08),
        ("sink", "Local-sink-positive", COLORS["green"], "s", 0.0),
        ("path", "Path-positive", COLORS["red"], "D", 0.08),
    ]
    for evidence_name, label, color, marker, offset in scale_series:
        rates = np.array(
            [row[evidence_name]["rate"] * 100 for row in size_strata]
        )
        lower = np.array(
            [row[evidence_name]["wilson95"][0] * 100 for row in size_strata]
        )
        upper = np.array(
            [row[evidence_name]["wilson95"][1] * 100 for row in size_strata]
        )
        ax.errorbar(
            decile_x + offset,
            rates,
            yerr=np.vstack([rates - lower, upper - rates]),
            color=color,
            marker=marker,
            markersize=2.6,
            markerfacecolor="white",
            markeredgewidth=0.7,
            linewidth=1.0,
            elinewidth=0.55,
            capsize=1.2,
            capthick=0.55,
            label=label,
        )
    ax.set_ylim(-2, 105)
    ax.set_xticks(decile_x)
    ax.set_xticklabels(
        [
            f"D{row['decile']}\n{row['medianMethods']:.0f}"
            for row in size_strata
        ],
        fontsize=5.0,
    )
    ax.set_xlabel("Method decile / median methods")
    ax.set_ylabel("Positive projects (%)")
    ax.set_title("(c) Scale-stratified prevalence", fontsize=6.2)
    ax.grid(
        axis="y",
        color=COLORS["gray"],
        linewidth=0.35,
        alpha=0.55,
    )
    ax.legend(
        loc="upper left",
        bbox_to_anchor=(0.02, 0.98),
        fontsize=4.7,
        frameon=True,
        facecolor="white",
        edgecolor="none",
        framealpha=0.92,
        borderpad=0.20,
        handlelength=1.4,
    )

    ax = axes[3]
    y_positions = np.arange(len(path_group_specs) - 1, -1, -1)
    compact_path_labels = [
        "Privacy\nIFDS",
        "Privacy\nAsync",
        "Privacy\nDual",
        "Framework\nIFDS",
    ]
    max_path = max(
        (max(lengths) for lengths in path_groups.values()),
        default=2,
    )
    for y_position, (
        source_kind,
        provenance,
        _,
        color,
    ) in zip(y_positions, path_group_specs):
        key = f"{source_kind}|{provenance}"
        lengths = path_groups.get(key, [])
        if not lengths:
            continue
        frequencies = Counter(lengths)
        statement_counts = np.array(sorted(frequencies))
        frequency_counts = np.array(
            [frequencies[value] for value in statement_counts]
        )
        values = np.asarray(lengths, dtype=float)
        q1, median, q3, p95 = np.percentile(values, [25, 50, 75, 95])
        ax.scatter(
            statement_counts,
            np.full(len(statement_counts), y_position),
            s=5.0 + frequency_counts * 0.32,
            color=color,
            alpha=0.38,
            edgecolors=color,
            linewidths=0.55,
            zorder=2,
        )
        summary_y = y_position + 0.24
        ax.hlines(
            summary_y,
            q1,
            q3,
            color=color,
            linewidth=2.5,
            zorder=3,
        )
        ax.plot(
            median,
            summary_y,
            marker="D",
            markersize=3.0,
            color=color,
            markeredgecolor="white",
            markeredgewidth=0.45,
            zorder=4,
        )
        ax.plot(
            p95,
            summary_y,
            marker="^",
            markersize=3.2,
            color=color,
            markerfacecolor="white",
            markeredgewidth=0.7,
            zorder=4,
        )
        ax.text(
            max_path + 1.0,
            y_position,
            f"n={len(lengths)}",
            va="center",
            ha="left",
            fontsize=4.8,
            color=COLORS["dark_gray"],
        )
    ax.set_yticks(y_positions)
    ax.set_yticklabels(compact_path_labels, fontsize=5.2)
    ax.set_xlim(1.5, max_path + 4.0)
    ax.set_xticks([2, 4, 6, 8, 10, 14, 18, 22])
    ax.set_ylim(-0.55, len(path_group_specs) - 0.35)
    ax.set_xlabel("Statements per path (area = count)")
    ax.set_title("(d) Path length by source/provenance", fontsize=6.2)
    ax.grid(
        axis="x",
        color=COLORS["gray"],
        linewidth=0.35,
        alpha=0.55,
    )
    median_handle = ax.scatter(
        [],
        [],
        marker="D",
        s=11,
        color=COLORS["dark_gray"],
        label="median",
    )
    p95_handle = ax.scatter(
        [],
        [],
        marker="^",
        s=12,
        facecolor="white",
        edgecolor=COLORS["dark_gray"],
        linewidth=0.7,
        label="P95",
    )
    ax.legend(
        handles=[median_handle, p95_handle],
        loc="upper right",
        bbox_to_anchor=(0.99, 0.99),
        fontsize=4.7,
        ncol=2,
        handletextpad=0.25,
        columnspacing=0.65,
        frameon=True,
        facecolor="white",
        edgecolor="none",
        framealpha=0.92,
        borderpad=0.18,
    )

    fig.subplots_adjust(left=0.068, right=0.995, bottom=0.29, top=0.88)
    output = FIG_DIR / "eval_corpus_landscape.pdf"
    fig.savefig(output, bbox_inches="tight")
    plt.close(fig)

    top_cutoffs = {}
    for cutoff in [10, 20, 50, 100, 120, 236]:
        index = min(cutoff, len(cumulative)) - 1
        top_cutoffs[str(cutoff)] = {
            "apiUsages": int(
                sum(row["apis"] for row in sorted_projects[:cutoff])
            ),
            "share": float(cumulative[index] / 100),
        }

    scope_counts: Counter[tuple[str, str]] = Counter(
        (row["sourceKind"], row["sourceScope"]) for row in flow_rows
    )
    scope_projects: defaultdict[tuple[str, str], set[str]] = defaultdict(set)
    for row in flow_rows:
        scope_projects[(row["sourceKind"], row["sourceScope"])].add(
            row["project"]
        )

    derivation_counts: Counter[str] = Counter()
    derivation_projects: defaultdict[str, set[str]] = defaultdict(set)
    derivation_provenance: defaultdict[str, Counter[str]] = defaultdict(Counter)
    derivation_combinations: Counter[str] = Counter()
    for row in flow_rows:
        derivations = row["analysisDerivations"]
        if derivations:
            derivation_combinations["+".join(derivations)] += 1
        for derivation in derivations:
            derivation_counts[derivation] += 1
            derivation_projects[derivation].add(row["project"])
            derivation_provenance[derivation][row["provenance"]] += 1

    return {
        "categories": categories,
        "sinkTypes": SINK_ORDER,
        "categorySinkMatrix": matrix.tolist(),
        "topCutoffs": top_cutoffs,
        "correlations": {
            "methodsVsPaths": spearman_rho(methods, taints),
        },
        "continuationDerivations": {
            "counts": dict(sorted(derivation_counts.items())),
            "projects": {
                key: len(projects)
                for key, projects in sorted(derivation_projects.items())
            },
            "byProvenance": {
                key: dict(sorted(counts.items()))
                for key, counts in sorted(derivation_provenance.items())
            },
            "combinations": dict(sorted(derivation_combinations.items())),
        },
        "methodSizeDeciles": size_strata,
        "pathScope": {
            source_kind: {
                scope: {
                    "paths": scope_counts[(source_kind, scope)],
                    "projects": len(scope_projects[(source_kind, scope)]),
                }
                for scope in ["production", "test", "generated"]
            }
            for source_kind in ["privacy_data", "framework_input"]
        },
        "pathComplexity": {
            key: {
                "count": len(lengths),
                "q1Statements": float(np.percentile(lengths, 25)),
                "medianStatements": float(np.median(lengths)),
                "q3Statements": float(np.percentile(lengths, 75)),
                "p95Statements": float(np.percentile(lengths, 95)),
                "maxStatements": int(max(lengths)),
                "lengthFrequencies": {
                    str(statement_count): frequency
                    for statement_count, frequency in sorted(
                        Counter(lengths).items()
                    )
                },
            }
            for key, lengths in path_groups.items()
        },
    }


def main() -> None:
    args = parse_args()
    reports_dir = args.reports_dir.resolve()
    configure_style()
    FIG_DIR.mkdir(parents=True, exist_ok=True)
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)

    reports, run_manifest, manifest_path = load_single_run_reports(
        reports_dir
    )
    report_summary = summarize_reports(reports)

    corpus_figure = build_corpus_figure(report_summary)

    project_rows = report_summary["projectRows"]
    output = {
        "provenance": {
            "runId": reports_dir.name,
            "runManifest": manifest_path.name,
            "runManifestSha256": sha256_file(manifest_path),
            "runStartedAt": run_manifest.get("startedAt"),
            "runCompletedAt": run_manifest.get("completedAt"),
            "buildSha256": (
                run_manifest.get("inputs", {})
                .get("build", {})
                .get("sha256")
            ),
            "configHashes": run_manifest.get("inputs", {}).get(
                "configHashes", {}
            ),
            "reportCount": len(reports),
        },
        "aggregate": {
            "projects": len(project_rows),
            "projectsWithApis": sum(1 for row in project_rows if row["apis"]),
            "projectsWithSinks": sum(1 for row in project_rows if row["sinks"]),
            "projectsWithTaintFlows": sum(
                1 for row in project_rows if row["taints"]
            ),
            "apiUsages": sum(row["apis"] for row in project_rows),
            "sinks": sum(row["sinks"] for row in project_rows),
            "taintFlows": sum(row["taints"] for row in project_rows),
        },
        "corpusFigure": corpus_figure,
        "figures": [
            "figs/eval_corpus_landscape.pdf",
        ],
    }
    OUT_JSON.write_text(
        json.dumps(output, indent=2, ensure_ascii=True),
        encoding="utf-8",
    )
    print(json.dumps(output["provenance"], indent=2))
    print(json.dumps(output["aggregate"], indent=2))


if __name__ == "__main__":
    main()
