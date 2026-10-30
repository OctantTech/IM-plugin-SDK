/**
 * 插件依赖解析（插件可以嵌套依赖其他插件，如「全站工程师」依赖 Java + Vue3 插件）。
 *
 * 规则（docs/plugin-redesign.md）：
 *  - SemVer 范围解析为**精确版本**，写入 lock（复现安装）；
 *  - 拓扑安装：被依赖的先装；环检测；深度/节点上限；
 *  - 同一插件被多个依赖要求不同范围：取交集能选到的最高版本，选不到 → version_conflict；
 *  - 可选依赖装不上只警告；
 *  - 付费依赖统一计费：主插件 + 未拥有的付费依赖 = 订单总额；已拥有的不重复收费；
 *  - 按安装次数的插件每次安装消耗 1 次（perInstallConsumption 全量返回，由调用方扣减）。
 */
import { maxSatisfying, satisfies, validRange } from 'semver';
import type { PluginDependencyDeclaration } from './manifest';

export type PluginLicenseType = 'free' | 'perpetual' | 'install_pack' | 'subscription';

export interface CatalogVersion {
	version: string;
	dependencies?: readonly PluginDependencyDeclaration[];
}

export interface CatalogPlugin {
	id: string;
	displayName?: string;
	licenseType: PluginLicenseType;
	priceCents?: number;
	versions: readonly CatalogVersion[];
}

export type CatalogLookup = (pluginId: string) => CatalogPlugin | null | undefined;

export interface ResolvedNode {
	pluginId: string;
	displayName: string;
	version: string;
	licenseType: PluginLicenseType;
	priceCents: number;
	dependencies: string[];
	depth: number;
}

export interface BillingLine {
	pluginId: string;
	displayName: string;
	licenseType: PluginLicenseType;
	priceCents: number;
	owned: boolean;
	isPrincipal: boolean;
}

export interface BillingBreakdown {
	currency: 'CNY';
	principal: BillingLine;
	dependencies: BillingLine[];
	/** 未拥有项合计（分）。 */
	totalCents: number;
	/** 本次安装需要消耗安装次数的插件（按安装次数授权）。 */
	perInstallConsumption: Record<string, number>;
}

export type DependencyResolution =
	| {
			ok: true;
			/** 依赖在前、主插件在后的安装顺序。 */
			order: ResolvedNode[];
			lock: Record<string, string>;
			billing: BillingBreakdown;
			warnings: string[];
	  }
	| {
			ok: false;
			code: 'not_found' | 'invalid_range' | 'no_matching_version' | 'version_conflict' | 'cycle' | 'limit';
			message: string;
			detail?: Record<string, unknown>;
	  };

export interface ResolveOptions {
	rootVersionRange?: string;
	ownedPluginIds?: Iterable<string>;
	maxDepth?: number;
	maxNodes?: number;
}

export function resolveDependencyGraph(
	rootId: string,
	lookup: CatalogLookup,
	options: ResolveOptions = {}
): DependencyResolution {
	const maxDepth = options.maxDepth ?? 8;
	const maxNodes = options.maxNodes ?? 64;
	const owned = new Set(options.ownedPluginIds ?? []);
	const warnings: string[] = [];
	const chosen = new Map<string, { version: string; plugin: CatalogPlugin }>();
	const constraints = new Map<string, string[]>();

	interface QueueItem {
		id: string;
		range: string;
		depth: number;
		optional: boolean;
		requiredBy: string;
	}
	const queue: QueueItem[] = [
		{ id: rootId, range: options.rootVersionRange ?? '*', depth: 0, optional: false, requiredBy: '(root)' }
	];

	while (queue.length > 0) {
		const item = queue.shift()!;
		if (item.depth > maxDepth) {
			return {
				ok: false,
				code: 'limit',
				message: `依赖层级超过 ${maxDepth}（${item.requiredBy} → ${item.id}）`,
				detail: { pluginId: item.id, depth: item.depth }
			};
		}
		const plugin = lookup(item.id);
		if (!plugin) {
			if (item.optional) {
				warnings.push(`可选依赖 ${item.id} 不存在，已跳过`);
				continue;
			}
			return {
				ok: false,
				code: 'not_found',
				message: `依赖不存在：${item.id}（来自 ${item.requiredBy}）`,
				detail: { pluginId: item.id, requiredBy: item.requiredBy }
			};
		}
		if (validRange(item.range) === null) {
			return {
				ok: false,
				code: 'invalid_range',
				message: `依赖 ${item.id} 的版本范围非法：${item.range}`
			};
		}
		const versions = plugin.versions.map((row) => row.version);
		const catalogPlugin = plugin;
		const existing = chosen.get(item.id);
		if (existing) {
			const ranges = constraints.get(item.id) ?? [];
			ranges.push(item.range);
			constraints.set(item.id, ranges);
			if (satisfies(existing.version, item.range)) continue;
			// 已有选择不满足新范围：在所有版本里找同时满足所有约束的最高版本。
			const candidates = versions.filter((version) =>
				[...ranges, item.range].every((range) => satisfies(version, range))
			);
			const stacked = maxSatisfying(candidates, '*');
			if (!stacked) {
				return {
					ok: false,
					code: 'version_conflict',
					message: `依赖 ${item.id} 没有同时满足 ${[...ranges, item.range].join(' / ')} 的版本`,
					detail: { pluginId: item.id, ranges: [...ranges, item.range] }
				};
			}
			chosen.set(item.id, { version: stacked, plugin });
			syncChildren(stacked);
			continue;

			continue;
		}
		const picked = maxSatisfying(versions, item.range);
		if (!picked) {
			if (item.optional) {
				warnings.push(`可选依赖 ${item.id} 没有匹配 ${item.range} 的版本，已跳过`);
				continue;
			}
			return {
				ok: false,
				code: 'no_matching_version',
				message: `依赖 ${item.id} 没有匹配 ${item.range} 的版本（可用：${versions.join(', ') || '无'}）`,
				detail: { pluginId: item.id, range: item.range, versions }
			};
		}
		chosen.set(item.id, { version: picked, plugin });
		constraints.set(item.id, [item.range]);
		if (chosen.size > maxNodes) {
			return {
				ok: false,
				code: 'limit',
				message: `插件依赖数量超过 ${maxNodes}`,
				detail: { rootId }
			};
		}
		syncChildren(picked);

		function syncChildren(version: string): void {
			const catalogVersion = catalogPlugin.versions.find((row) => row.version === version);
			for (const dependency of catalogVersion?.dependencies ?? []) {
				queue.push({
					id: dependency.id,
					range: dependency.version,
					depth: item.depth + 1,
					optional: Boolean(dependency.optional),
					requiredBy: item.id
				});
			}
		}
	}

	// 拓扑排序 + 环检测（基于最终选中的版本图）。
	const nodes = new Map<string, ResolvedNode>();
	for (const [id, entry] of chosen) {
		const catalogVersion = entry.plugin.versions.find((row) => row.version === entry.version);
		nodes.set(id, {
			pluginId: id,
			displayName: entry.plugin.displayName ?? id,
			version: entry.version,
			licenseType: entry.plugin.licenseType,
			priceCents: entry.plugin.priceCents ?? 0,
			dependencies: (catalogVersion?.dependencies ?? []).map((dependency) => dependency.id),
			depth: 0
		});
	}
	const order: ResolvedNode[] = [];
	const state = new Map<string, 'visiting' | 'done'>();
	const visit = (id: string, stack: string[]): string | null => {
		const status = state.get(id);
		if (status === 'done') return null;
		if (status === 'visiting') return [...stack, id].join(' → ');
		state.set(id, 'visiting');
		const node = nodes.get(id);
		if (!node) return null;
		for (const dependencyId of node.dependencies) {
			const cycle = visit(dependencyId, [...stack, id]);
			if (cycle) return cycle;
		}
		state.set(id, 'done');
		order.push(node);
		return null;
	};
	for (const id of nodes.keys()) {
		const cycle = visit(id, []);
		if (cycle) {
			return { ok: false, code: 'cycle', message: `插件依赖出现环：${cycle}`, detail: { cycle } };
		}
	}
	// depth 重新按主插件可达路径计算（用于 UI 展示）。
	const depthOf = new Map<string, number>();
	const walk = (id: string, depth: number): void => {
		const best = depthOf.get(id);
		if (best !== undefined && best <= depth) return;
		depthOf.set(id, depth);
		for (const dependencyId of nodes.get(id)?.dependencies ?? []) walk(dependencyId, depth + 1);
	};
	walk(rootId, 0);
	for (const node of order) node.depth = depthOf.get(node.pluginId) ?? node.depth;

	const rootNode = nodes.get(rootId)!;
	const deps = order.filter((node) => node.pluginId !== rootId);
	const toLine = (node: ResolvedNode, isPrincipal: boolean): BillingLine => ({
		pluginId: node.pluginId,
		displayName: node.displayName,
		licenseType: node.licenseType,
		priceCents: node.priceCents,
		owned: owned.has(node.pluginId),
		isPrincipal
	});
	const principal = toLine(rootNode, true);
	const dependencyLines = deps.map((node) => toLine(node, false));
	const totalCents = [principal, ...dependencyLines]
		.filter((line) => !line.owned)
		.reduce((sum, line) => sum + line.priceCents, 0);
	const perInstallConsumption: Record<string, number> = {};
	for (const node of order) {
		if (node.licenseType === 'install_pack') perInstallConsumption[node.pluginId] = 1;
	}

	return {
		ok: true,
		order,
		lock: Object.fromEntries(order.map((node) => [node.pluginId, node.version])),
		billing: {
			currency: 'CNY',
			principal,
			dependencies: dependencyLines,
			totalCents,
			perInstallConsumption
		},
		warnings
	};
}
