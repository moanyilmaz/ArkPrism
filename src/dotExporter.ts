/**
 * ArkPrism - DOT Format Exporter (v2 - Multi-Source Enhanced)
 *
 * Generates Graphviz DOT visualization with two sections:
 *   1. Single-source subgraphs: grouped by (category, entry)
 *   2. Multi-source subgraphs: visualizing entry → LCA → sources → sinks
 *
 * Node types:
 *   - Entry point (green): Root lifecycle/interaction method
 *   - LCA node (gold): Lowest Common Ancestor in multi-source
 *   - Sensitive API (red): Privacy-sensitive API call
 *   - Internal function (blue): Intermediate method
 *   - Data sink (orange): Network/storage/log endpoint
 *
 * Edge types:
 *   - Direct call (solid): Standard invocation
 *   - Callback (dashed): Async/event handler
 *   - Data flow (dotted orange): Data to sink
 */

import {
    ArkPrismOutput, CallChainResult, PrivacyDataApiResult,
    DataSinkInfo, MultiSourceCollaboration
} from './prototypes';

// ---- Color palette ----

const CATEGORY_COLORS: Record<string, string> = {
    'device_identity.hardware': '#E74C3C',
    'device_identity.software': '#D35400',
    'device_identity.unique_id': '#C0392B',
    'device_identity.sim': '#E74C3C',
    'device_identity.ad_tracking': '#795548',
    'device_identity.distributed': '#607D8B',
    'device_identity.screen': '#9C27B0',
    'device_status.battery': '#FF5722',
    'device_status.sensor': '#E91E63',
    'network.connectivity': '#2ECC71',
    'network.wifi': '#27AE60',
    'network.bluetooth': '#00BCD4',
    'user_data.account': '#9B59B6',
    'user_data.clipboard': '#F39C12',
    'user_data.sms': '#FF5722',
    'user_data.contacts': '#00BCD4',
    'user_preference.locale': '#3F51B5',
    'user_preference.settings': '#3F51B5',
    'location': '#3498DB',
    'media.camera': '#1ABC9C',
    'media.audio': '#E67E22',
    'app_environment': '#78909C',
};

const CATEGORY_LABELS: Record<string, string> = {
    'device_identity.hardware': 'DEVICE_INFO',
    'device_identity.software': 'OS_INFO',
    'device_identity.unique_id': 'DEVICE_ID',
    'device_identity.sim': 'SIM_INFO',
    'device_identity.ad_tracking': 'AD_ID',
    'device_identity.distributed': 'DISTRIBUTED',
    'device_identity.screen': 'SCREEN',
    'device_status.battery': 'BATTERY',
    'device_status.sensor': 'SENSOR',
    'network.connectivity': 'NETWORK',
    'network.wifi': 'WIFI',
    'network.bluetooth': 'BLUETOOTH',
    'user_data.account': 'ACCOUNT',
    'user_data.clipboard': 'CLIPBOARD',
    'user_data.sms': 'SMS',
    'user_data.contacts': 'CONTACTS',
    'user_preference.locale': 'LOCALE',
    'user_preference.settings': 'SETTINGS',
    'location': 'LOCATION',
    'media.camera': 'CAMERA',
    'media.audio': 'MICROPHONE',
    'app_environment': 'APP_ENV',
};

function getColor(category: string): string { return CATEGORY_COLORS[category] || '#888'; }
function getLabel(category: string): string { return CATEGORY_LABELS[category] || category.toUpperCase(); }

// ---- Utilities ----

function sanitize(prefix: string, name: string): string {
    return `"${prefix}_${name.replace(/[^a-zA-Z0-9_]/g, '_')}"`;
}

function esc(s: string): string {
    return s.replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/** Resolve display name: replace %AMx$method with readable callback name */
function displayName(name: string): string {
    let resolved = name.replace(/%AM(\d+)\$(\w+)/g, (_, num, method) => `${method}_cb${num}`);
    // Shorten: keep only last 2 segments
    let parts = resolved.split('.');
    if (parts.length > 2) return parts.slice(-2).join('.');
    return resolved;
}

// ---- Node & Edge rendering ----

type NodeType = 'entry' | 'lca' | 'api' | 'internal' | 'sink';

const NODE_STYLES: Record<NodeType, string> = {
    entry: 'shape=box, style="filled,bold", fillcolor="#D5E8D4", fontcolor="#2D7D2D", penwidth=1.5',
    lca: 'shape=hexagon, style="filled,bold", fillcolor="#FFF9C4", fontcolor="#F57F17", penwidth=2',
    api: 'shape=box, style="filled", fillcolor="#FFE6E6", fontcolor="#CC0000", penwidth=1',
    internal: 'shape=box, style="filled", fillcolor="#DAE8FC", fontcolor="#1A5276", penwidth=0.8',
    sink: 'shape=box, style="filled,rounded", fillcolor="#FFF3E0", fontcolor="#E65100", penwidth=1',
};

function renderNode(id: string, label: string, type: NodeType): string {
    return `    ${id} [label="${label}", ${NODE_STYLES[type]}, fontname="Helvetica", fontsize=9];`;
}

type EdgeStyle = 'direct' | 'callback' | 'datasink' | 'lifecycle';

const EDGE_STYLES: Record<EdgeStyle, string> = {
    direct: 'style=solid, color="#555555", penwidth=1.2',
    callback: 'style=dashed, color="#2980B9", penwidth=1.0',
    datasink: 'style=dotted, color="#FF9800", arrowhead=vee, penwidth=1.2',
    lifecycle: 'style=dotted, color="#888888", penwidth=0.8',
};

function renderEdge(from: string, to: string, style: EdgeStyle, edgeLabel?: string): string {
    let extra = edgeLabel ? `, label="${esc(edgeLabel)}", fontsize=7, fontname="Helvetica"` : '';
    return `    ${from} -> ${to} [${EDGE_STYLES[style]}${extra}];`;
}

// ---- Section 1: Single-source subgraphs ----

function buildSingleSourceSubgraphs(output: ArkPrismOutput): string[] {
    let lines: string[] = [];

    // Group by (category, entry)
    let groups = new Map<string, { category: string; chains: { c: CallChainResult; a: PrivacyDataApiResult }[] }>();
    for (let chain of output.callChains) {
        let api = output.privacyApiUsages[chain.apiUsageIndex];
        if (!api) continue;
        let cat = api.profilingCategory || 'unknown';
        let entry = chain.entryMethod.name;
        let key = `${cat}__${entry}`;
        if (!groups.has(key)) groups.set(key, { category: cat, chains: [] });
        groups.get(key)!.chains.push({ c: chain, a: api });
    }

    let idx = 0;
    for (let [, group] of groups) {
        let pf = `s${idx}`;
        let color = getColor(group.category);
        let catLabel = getLabel(group.category);
        let entryName = group.chains[0].c.entryMethod.name;
        let apiCount = group.chains.length;
        let file = group.chains[0].c.entryMethod.file.split('/').pop() || '';

        lines.push(`  subgraph cluster_single_${idx} {`);
        lines.push(`    label="${idx}: ${catLabel} (${apiCount} APIs)\\n${esc(file)}";`);
        lines.push(`    style=rounded; color="${color}"; fontcolor="${color}";`);
        lines.push('    fontname="Helvetica"; fontsize=10;');
        lines.push('');

        let nodes = new Map<string, { label: string; type: NodeType }>();
        let edges: { from: string; to: string; style: EdgeStyle; label?: string }[] = [];

        for (let { c: chain, a: api } of group.chains) {
            // Entry node
            let entryId = sanitize(pf, chain.entryMethod.name);
            if (!nodes.has(entryId)) {
                nodes.set(entryId, {
                    label: `${esc(displayName(chain.entryMethod.name))}\\n[${chain.entryMethod.type}]`,
                    type: 'entry'
                });
            }

            // API node
            let apiStr = `${api.namespace}.${api.method}`;
            let apiId = sanitize(pf, apiStr);
            if (!nodes.has(apiId)) {
                nodes.set(apiId, {
                    label: `${esc(apiStr)}\\n[${catLabel}]`,
                    type: 'api'
                });
            }

            // Chain links
            if (chain.chain.length === 0) continue;
            let prev = entryId;
            for (let i = 0; i < chain.chain.length; i++) {
                let link = chain.chain[i];
                let isLast = i === chain.chain.length - 1;
                let calleeDisp = link.resolvedCalleeName || displayName(link.callee);
                let calleeId = isLast ? apiId : sanitize(pf, link.callee);

                if (!isLast && !nodes.has(calleeId)) {
                    nodes.set(calleeId, { label: esc(calleeDisp), type: 'internal' });
                }

                let callerId = i === 0 ? entryId : sanitize(pf, link.caller);
                if (i > 0 && !nodes.has(callerId)) {
                    let callerDisp = link.resolvedCallerName || displayName(link.caller);
                    nodes.set(callerId, { label: esc(callerDisp), type: 'internal' });
                }

                let eStyle: EdgeStyle = link.callType === 'callback' ? 'callback' : 'direct';
                let dup = edges.some(e => e.from === callerId && e.to === calleeId);
                if (!dup) edges.push({ from: callerId, to: calleeId, style: eStyle });
                prev = calleeId;
            }

            // Sinks
            if (chain.dataSinks) {
                let sinksSeen = new Set<string>();
                for (let sink of chain.dataSinks) {
                    let sinkKey = `${sink.sinkApi}_${sink.sinkType}`;
                    if (sinksSeen.has(sinkKey)) continue;
                    sinksSeen.add(sinkKey);
                    let sinkId = sanitize(pf, `sink_${sinkKey}`);
                    if (!nodes.has(sinkId)) {
                        nodes.set(sinkId, {
                            label: `${esc(sink.sinkApi)}\\n[${sink.sinkType.toUpperCase()}]`,
                            type: 'sink'
                        });
                    }
                    let dup = edges.some(e => e.from === apiId && e.to === sinkId);
                    if (!dup) edges.push({ from: apiId, to: sinkId, style: 'datasink' });
                }
            }
        }

        for (let [id, n] of nodes) lines.push(renderNode(id, n.label, n.type));
        lines.push('');
        for (let e of edges) lines.push(renderEdge(e.from, e.to, e.style, e.label));
        lines.push('  }');
        lines.push('');
        idx++;
    }

    return lines;
}

// ---- Section 2: Multi-source collaboration subgraphs ----

function buildMultiSourceSubgraphs(output: ArkPrismOutput): string[] {
    let lines: string[] = [];
    let collabs = output.multiSourceCollaborations || [];
    let withSubgraph = collabs.filter(c => c.subgraph);

    for (let i = 0; i < withSubgraph.length; i++) {
        let collab = withSubgraph[i];
        let sg = collab.subgraph!;
        let pf = `ms${i}`;
        let cats = collab.categories.map(c => getLabel(c)).join(' + ');
        let riskColor = collab.riskLevel === 'high' ? '#C62828' :
            collab.riskLevel === 'medium' ? '#E65100' : '#2E7D32';

        lines.push(`  subgraph cluster_multi_${i} {`);
        lines.push(`    label="MULTI-SOURCE #${i}: ${cats}\\nRisk: ${collab.riskLevel.toUpperCase()} | ${collab.apis.length} APIs | ${collab.categories.length} categories";`);
        lines.push(`    style="rounded,bold"; color="${riskColor}"; fontcolor="${riskColor}";`);
        lines.push('    fontname="Helvetica"; fontsize=11;');
        lines.push(`    bgcolor="#FFFDE7";`);
        lines.push('');

        let nodes = new Map<string, { label: string; type: NodeType }>();
        let edges: { from: string; to: string; style: EdgeStyle; label?: string }[] = [];

        // Entry node
        let entryId = sanitize(pf, 'entry');
        nodes.set(entryId, {
            label: `${esc(displayName(sg.entry.name))}\\n[${sg.entry.type}]\\n${esc(sg.entry.file.split('/').pop() || '')}`,
            type: 'entry'
        });

        // LCA node
        let lcaId = sanitize(pf, 'lca');
        nodes.set(lcaId, {
            label: `${esc(displayName(collab.lcaMethod))}\\n[LCA / multi-source root]`,
            type: 'lca'
        });

        // Entry → LCA path
        if (sg.entryToLca.length > 0) {
            let prev = entryId;
            for (let j = 0; j < sg.entryToLca.length; j++) {
                let link = sg.entryToLca[j];
                let isLast = j === sg.entryToLca.length - 1;
                let calleeDisp = link.resolvedCalleeName || displayName(link.callee);

                let calleeId: string;
                if (isLast) {
                    // Last link callee should connect to LCA
                    calleeId = lcaId;
                } else {
                    calleeId = sanitize(pf, `path_${j}_${link.callee}`);
                    if (!nodes.has(calleeId)) {
                        nodes.set(calleeId, { label: esc(calleeDisp), type: 'internal' });
                    }
                }

                let eStyle: EdgeStyle = link.callType === 'callback' ? 'callback' : 'direct';
                edges.push({ from: prev, to: calleeId, style: eStyle });
                prev = calleeId;
            }
        } else {
            // Direct connection
            edges.push({ from: entryId, to: lcaId, style: 'direct' });
        }

        // Branches: LCA → each source → sinks
        for (let b = 0; b < sg.branches.length; b++) {
            let branch = sg.branches[b];
            let catColor = getColor(branch.category);
            let catLabel = getLabel(branch.category);

            // API node
            let apiId = sanitize(pf, `api_${b}_${branch.api}`);
            nodes.set(apiId, {
                label: `${esc(branch.api)}\\n[${catLabel}]`,
                type: 'api'
            });

            // LCA → source path
            if (branch.lcaToSource.length > 0) {
                let prev = lcaId;
                for (let j = 0; j < branch.lcaToSource.length; j++) {
                    let link = branch.lcaToSource[j];
                    let isLast = j === branch.lcaToSource.length - 1;
                    let calleeId = isLast ? apiId : sanitize(pf, `br${b}_${j}_${link.callee}`);

                    if (!isLast && !nodes.has(calleeId)) {
                        let calleeDisp = link.resolvedCalleeName || displayName(link.callee);
                        nodes.set(calleeId, { label: esc(calleeDisp), type: 'internal' });
                    }

                    let eStyle: EdgeStyle = link.callType === 'callback' ? 'callback' : 'direct';
                    edges.push({ from: prev, to: calleeId, style: eStyle });
                    prev = calleeId;
                }
            } else {
                // Same-method: LCA directly contains the API
                edges.push({ from: lcaId, to: apiId, style: 'direct' });
            }

            // Sinks for this branch
            let sinksSeen = new Set<string>();
            for (let sink of branch.sinks) {
                let sinkKey = `${sink.sinkApi}_${sink.sinkType}`;
                if (sinksSeen.has(sinkKey)) continue;
                sinksSeen.add(sinkKey);
                let sinkId = sanitize(pf, `bsink_${b}_${sinkKey}`);
                if (!nodes.has(sinkId)) {
                    nodes.set(sinkId, {
                        label: `${esc(sink.sinkApi)}\\n[${sink.sinkType.toUpperCase()}]`,
                        type: 'sink'
                    });
                }
                edges.push({ from: apiId, to: sinkId, style: 'datasink' });
            }
        }

        for (let [id, n] of nodes) lines.push(renderNode(id, n.label, n.type));
        lines.push('');
        for (let e of edges) lines.push(renderEdge(e.from, e.to, e.style, e.label));
        lines.push('  }');
        lines.push('');
    }

    return lines;
}

// ---- Main ----

/**
 * Generate a complete DOT string from ArkPrism output.
 */
export function generateDot(output: ArkPrismOutput): string {
    let lines: string[] = [];

    lines.push('digraph ArkPrism_Privacy {');
    lines.push('  rankdir=TB;');
    lines.push('  bgcolor="#FAFAFA";');
    lines.push('  node [margin=0.12];');
    lines.push('  edge [arrowsize=0.7];');
    lines.push('  label="ArkPrism Privacy Analysis\\n' + esc(output.projectName) + '";');
    lines.push('  labelloc=t; fontname="Helvetica Bold"; fontsize=14; fontcolor="#333333";');
    lines.push('');

    // Legend
    lines.push('  subgraph cluster_legend {');
    lines.push('    label="Legend"; style=rounded; color="#CCCCCC";');
    lines.push('    fontname="Helvetica"; fontsize=9;');
    lines.push('    _l1 [label="Entry Point\\n(lifecycle/event)", ' + NODE_STYLES.entry + ', fontname="Helvetica", fontsize=7];');
    lines.push('    _l2 [label="LCA\\n(multi-source root)", ' + NODE_STYLES.lca + ', fontname="Helvetica", fontsize=7];');
    lines.push('    _l3 [label="Sensitive API\\n(source)", ' + NODE_STYLES.api + ', fontname="Helvetica", fontsize=7];');
    lines.push('    _l4 [label="Internal\\n(function)", ' + NODE_STYLES.internal + ', fontname="Helvetica", fontsize=7];');
    lines.push('    _l5 [label="Data Sink\\n(network/log/...)", ' + NODE_STYLES.sink + ', fontname="Helvetica", fontsize=7];');
    lines.push('    _l1 -> _l2 -> _l4 -> _l3 -> _l5 [style=invis];');
    lines.push('  }');
    lines.push('');

    // Multi-source subgraphs (most important, render first)
    let multiLines = buildMultiSourceSubgraphs(output);
    if (multiLines.length > 0) {
        lines.push('  // ===== MULTI-SOURCE COLLABORATIONS =====');
        lines.push('');
        lines = lines.concat(multiLines);
    }

    // Single-source subgraphs
    let singleLines = buildSingleSourceSubgraphs(output);
    if (singleLines.length > 0) {
        lines.push('  // ===== SINGLE-SOURCE CALL CHAINS =====');
        lines.push('');
        lines = lines.concat(singleLines);
    }

    lines.push('}');
    return lines.join('\n');
}
