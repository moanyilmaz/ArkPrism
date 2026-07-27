"""Generate the three-panel HapBench evaluation figure."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import matplotlib as mpl
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Patch


PAPER_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RESULTS = Path(
    r"E:\arkprism-fse2027-experiments"
    r"\docs\experiment_hapbench_20260727_v22_final\hapbench_results.json"
)
DEFAULT_FIGURE = PAPER_ROOT / "figs" / "eval_hapbench.pdf"
DEFAULT_SUMMARY = PAPER_ROOT / "data" / "hapbench_figure_summary.json"

COLORS = {
    "hapflow": "#D55E00",
    "arkprism": "#0072B2",
    "recall": "#0072B2",
    "specificity": "#D55E00",
    "f1": "#009E73",
    "mcc": "#7A5195",
    "grid": "#D6E0E8",
    "text": "#263746",
    "muted": "#667786",
}

CATEGORY_LABELS = {
    "Aliasing": "Alias",
    "Anonymous Constructs": "Anon.",
    "Array-Like Structures": "Array",
    "Field and Object Sensitivity": "Field",
    "General Language Features": "Lang.",
    "Lifecycle Modeling": "Life.",
    "OpenHarmony Specific APIs": "OH API",
}

CONFIG_LABELS = {
    "HapFlow artifact reproduction": "HapFlow",
    "ArkPrism full": "Full",
    "ArkPrism callback-off": "-callback",
    "ArkPrism no-ir": "-IR",
    "ArkPrism no-receiver": "-receiver",
    "ArkPrism unbounded-lifecycle": "unbounded",
}

ABLATION_LABELS = {
    "ArkPrism callback-off": r"$-$callback",
    "ArkPrism no-ir": r"$-$IR recovery",
    "ArkPrism no-receiver": r"$-$receiver",
    "ArkPrism unbounded-lifecycle": "unbounded LC",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--results", type=Path, default=DEFAULT_RESULTS)
    parser.add_argument("--output", type=Path, default=DEFAULT_FIGURE)
    parser.add_argument("--summary", type=Path, default=DEFAULT_SUMMARY)
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def configure_style() -> None:
    mpl.rcParams.update(
        {
            "font.family": "DejaVu Sans",
            "font.size": 6.8,
            "axes.titlesize": 7.7,
            "axes.labelsize": 6.8,
            "axes.linewidth": 0.65,
            "xtick.labelsize": 6.0,
            "ytick.labelsize": 6.0,
            "legend.fontsize": 5.8,
            "legend.frameon": False,
            "pdf.fonttype": 42,
            "ps.fonttype": 42,
            "savefig.transparent": False,
        }
    )


def comparison_p_value(
    data: dict[str, Any], left: str, right: str
) -> float:
    for comparison in data["comparisons"]:
        names = {comparison["left"], comparison["right"]}
        if names == {left, right}:
            return float(comparison["exactTwoSidedP"])
    raise KeyError(f"Missing paired comparison: {left} vs. {right}")


def add_statistical_uncertainty(
    ax: plt.Axes,
    hapflow: dict[str, Any],
    arkprism: dict[str, Any],
) -> dict[str, Any]:
    metrics = [
        ("precision", "Precision"),
        ("recall", "Recall"),
        ("specificity", "Specificity"),
        ("accuracy", "Accuracy"),
    ]
    y_positions = np.arange(len(metrics), dtype=float)
    tool_specs = [
        ("HapFlow", hapflow, COLORS["hapflow"], "s", -0.09),
        ("ArkPrism", arkprism, COLORS["arkprism"], "o", 0.09),
    ]
    summary: dict[str, Any] = {}

    for label, tool, color, marker, offset in tool_specs:
        estimates = np.asarray(
            [float(tool["overall"][key]) * 100 for key, _ in metrics]
        )
        confidence_intervals = np.asarray(
            [
                np.asarray(
                    tool["overall"]["confidence95"][key],
                    dtype=float,
                )
                * 100
                for key, _ in metrics
            ]
        )
        lower = estimates - confidence_intervals[:, 0]
        upper = confidence_intervals[:, 1] - estimates
        shifted_y = y_positions + offset
        ax.plot(
            estimates,
            shifted_y,
            color=color,
            linewidth=1.2,
            alpha=0.8,
            zorder=1,
        )
        ax.errorbar(
            estimates,
            shifted_y,
            xerr=np.vstack([lower, upper]),
            color=color,
            ecolor=color,
            marker=marker,
            markersize=4.6,
            markerfacecolor=color,
            markeredgecolor="white",
            markeredgewidth=0.4,
            linewidth=0,
            elinewidth=1.25,
            capsize=2.4,
            capthick=1.25,
            label=label,
            zorder=3,
        )
        summary[tool["name"]] = {
            key: {
                "estimate": float(estimate),
                "wilson95": interval.tolist(),
            }
            for (key, _), estimate, interval in zip(
                metrics,
                estimates,
                confidence_intervals,
            )
        }

    ax.set_yticks(y_positions, [label for _, label in metrics])
    ax.set_xlim(40, 102)
    ax.set_xticks([40, 60, 80, 100])
    ax.set_xlabel("Estimate and 95% Wilson CI (%)")
    ax.invert_yaxis()
    ax.grid(axis="x", color=COLORS["grid"], linewidth=0.55, zorder=0)
    ax.tick_params(axis="y", length=0, pad=3)
    ax.set_title("(a) Statistical uncertainty", loc="left", pad=5)
    ax.legend(
        loc="lower left",
        handlelength=1.6,
        handletextpad=0.45,
        borderaxespad=0.2,
    )
    return summary


def add_category_configuration_heatmap(
    ax: plt.Axes,
    tools: list[dict[str, Any]],
) -> dict[str, Any]:
    categories = list(tools[1]["categories"].keys())
    error_rates = np.zeros((len(categories), len(tools)), dtype=float)
    error_counts = np.zeros_like(error_rates, dtype=int)
    for row, category in enumerate(categories):
        for col, tool in enumerate(tools):
            stats = tool["categories"][category]
            count = int(stats["fn"]) + int(stats["fp"])
            total = int(stats["evaluated"])
            error_counts[row, col] = count
            error_rates[row, col] = 100.0 * count / total if total else 0.0

    image = ax.imshow(
        error_rates,
        cmap="Reds",
        vmin=0,
        vmax=40,
        aspect="auto",
        interpolation="nearest",
    )
    for row in range(len(categories)):
        for col in range(len(tools)):
            value = error_counts[row, col]
            ax.text(
                col,
                row,
                str(int(value)),
                ha="center",
                va="center",
                fontsize=5.7,
                color=("white" if error_rates[row, col] >= 22 else "#31506A"),
                fontweight="bold" if value else "normal",
            )

    category_sizes = [
        int(tools[1]["categories"][category]["evaluated"])
        for category in categories
    ]
    ax.set_yticks(
        np.arange(len(categories)),
        [
            f"{CATEGORY_LABELS[category]} ({size})"
            for category, size in zip(categories, category_sizes)
        ],
    )
    ax.set_xticks(
        np.arange(len(tools)),
        [CONFIG_LABELS[tool["name"]] for tool in tools],
        rotation=34,
        ha="right",
        rotation_mode="anchor",
    )
    ax.set_xticks(np.arange(-0.5, len(tools), 1), minor=True)
    ax.set_yticks(np.arange(-0.5, len(categories), 1), minor=True)
    ax.grid(which="minor", color="white", linewidth=0.75)
    ax.tick_params(which="minor", length=0)
    ax.tick_params(which="major", length=0, pad=2)
    ax.set_title("(b) Errors by category/configuration", loc="left", pad=5)
    colorbar = ax.figure.colorbar(
        image,
        ax=ax,
        fraction=0.042,
        pad=0.025,
        ticks=[0, 10, 20, 30, 40],
    )
    colorbar.set_label("Error rate (%)", labelpad=3)
    colorbar.ax.tick_params(labelsize=5.7, length=2)
    return {
        "categories": categories,
        "toolOrder": [tool["name"] for tool in tools],
        "errorCounts": error_counts.tolist(),
        "errorRatesPercent": error_rates.tolist(),
    }


def add_paired_ablation_effects(
    ax: plt.Axes,
    data: dict[str, Any],
    full: dict[str, Any],
    ablations: list[dict[str, Any]],
) -> dict[str, Any]:
    metric_specs = [
        ("recall", "Recall", COLORS["recall"], "o", "-"),
        (
            "specificity",
            "Specificity",
            COLORS["specificity"],
            "s",
            "--",
        ),
        ("f1", "F1", COLORS["f1"], "^", "-."),
        ("mcc", "MCC", COLORS["mcc"], "D", ":"),
    ]
    row_positions = np.arange(len(ablations), dtype=float)
    offsets = np.linspace(-0.15, 0.15, len(metric_specs))
    summary: dict[str, Any] = {}

    for metric_index, (key, label, color, marker, line_style) in enumerate(
        metric_specs
    ):
        deltas = np.asarray(
            [
                (
                    float(ablation["overall"][key])
                    - float(full["overall"][key])
                )
                * 100
                for ablation in ablations
            ]
        )
        for row, delta in enumerate(deltas):
            y_value = row_positions[row] + offsets[metric_index]
            ax.hlines(
                y_value,
                min(0.0, delta),
                max(0.0, delta),
                color=color,
                linewidth=1.3,
                linestyle=line_style,
                alpha=0.78,
                zorder=1,
            )
            ax.scatter(
                delta,
                y_value,
                s=22,
                marker=marker,
                color=color,
                edgecolor="white",
                linewidth=0.4,
                zorder=3,
            )
        for ablation, delta in zip(ablations, deltas):
            summary.setdefault(ablation["name"], {})[key] = float(delta)

    p_values: dict[str, float] = {}
    for row, ablation in enumerate(ablations):
        p_value = comparison_p_value(data, full["name"], ablation["name"])
        p_values[ablation["name"]] = p_value
        p_label = "$p=1$" if p_value == 1 else f"$p={p_value:.3g}$"
        ax.text(
            8.0,
            row,
            p_label,
            ha="left",
            va="center",
            fontsize=5.7,
            color=COLORS["muted"],
        )

    ax.axvline(0, color="#5C6A75", linewidth=0.8, zorder=0)
    ax.set_xlim(-35, 14)
    ax.set_xticks([-30, -20, -10, 0, 10])
    ax.set_yticks(
        row_positions,
        [ABLATION_LABELS[ablation["name"]] for ablation in ablations],
    )
    ax.set_xlabel("Change from full configuration (points)")
    ax.set_ylim(len(ablations) - 0.55, -0.55)
    ax.grid(axis="x", color=COLORS["grid"], linewidth=0.55, zorder=0)
    ax.tick_params(axis="y", length=0, pad=3)
    ax.set_title("(c) Paired ablation effects", loc="left", pad=5)
    ax.legend(
        handles=[
            Patch(facecolor=color, label=label)
            for _, label, color, _, _ in metric_specs
        ],
        loc="upper center",
        bbox_to_anchor=(0.5, -0.27),
        ncol=4,
        handlelength=0.75,
        handletextpad=0.35,
        columnspacing=0.65,
        borderaxespad=0.2,
    )
    return {
        "metricDeltaPoints": summary,
        "exactTwoSidedMcNemarP": p_values,
    }


def main() -> None:
    args = parse_args()
    data = load_json(args.results)
    tools_by_name = {tool["name"]: tool for tool in data["tools"]}
    ordered_names = [
        "HapFlow artifact reproduction",
        "ArkPrism full",
        "ArkPrism no-ir",
        "ArkPrism no-receiver",
        "ArkPrism unbounded-lifecycle",
    ]
    tools = [tools_by_name[name] for name in ordered_names]
    hapflow = tools[0]
    arkprism = tools[1]
    ablations = tools[2:]

    configure_style()
    figure = plt.figure(figsize=(7.15, 1.95))
    grid = figure.add_gridspec(
        1,
        3,
        width_ratios=[1.0, 1.42, 1.35],
        left=0.075,
        right=0.992,
        top=0.86,
        bottom=0.32,
        wspace=0.47,
    )
    ax_uncertainty = figure.add_subplot(grid[0, 0])
    ax_heatmap = figure.add_subplot(grid[0, 1])
    ax_ablation = figure.add_subplot(grid[0, 2])

    uncertainty = add_statistical_uncertainty(
        ax_uncertainty,
        hapflow,
        arkprism,
    )
    category_errors = add_category_configuration_heatmap(ax_heatmap, tools)
    ablation_effects = add_paired_ablation_effects(
        ax_ablation,
        data,
        arkprism,
        ablations,
    )

    for ax in [ax_uncertainty, ax_ablation]:
        ax.spines[["top", "right"]].set_visible(False)
    ax_heatmap.spines[:].set_visible(False)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(
        args.output,
        bbox_inches="tight",
        pad_inches=0.025,
        dpi=220,
    )
    plt.close(figure)

    summary = {
        "source": str(args.results),
        "toolOrder": ordered_names,
        "statisticalUncertainty": uncertainty,
        "categoryConfigurationErrors": category_errors,
        "pairedAblationEffects": ablation_effects,
    }
    args.summary.parent.mkdir(parents=True, exist_ok=True)
    with args.summary.open("w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=2)


if __name__ == "__main__":
    main()
