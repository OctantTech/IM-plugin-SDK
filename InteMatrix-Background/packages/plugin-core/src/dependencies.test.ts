import { describe, expect, it } from 'vitest';
import { resolveDependencyGraph, type CatalogPlugin, type CatalogLookup } from './dependencies';

function plugin(
	id: string,
	versions: Array<{ version: string; dependencies?: Array<{ id: string; version: string; optional?: boolean }> }>,
	options: { licenseType?: CatalogPlugin['licenseType']; priceCents?: number; displayName?: string } = {}
): CatalogPlugin {
	return {
		id,
		displayName: options.displayName ?? id,
		licenseType: options.licenseType ?? 'free',
		priceCents: options.priceCents ?? 0,
		versions
	};
}

function lookupOf(...plugins: CatalogPlugin[]): CatalogLookup {
	const map = new Map(plugins.map((item) => [item.id, item]));
	return (id) => map.get(id);
}

describe('插件依赖解析（嵌套 + 版本 + 计费）', () => {
	it('全站工程师 → Java + Vue3：依赖先装、lock 固定、免费依赖不收费', () => {
		const lookup = lookupOf(
			plugin('fullstack', [
				{
					version: '1.3.0',
					dependencies: [
						{ id: 'java', version: '^2.1.0' },
						{ id: 'vue3', version: '^1.4.0' }
					]
				}
			]),
			plugin('java', [{ version: '2.1.0' }, { version: '2.2.1' }]),
			plugin('vue3', [{ version: '1.4.0' }, { version: '1.5.0' }])
		);
		const resolved = resolveDependencyGraph('fullstack', lookup, { rootVersionRange: '^1.0.0' });
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) return;
		expect(resolved.order.map((node) => node.pluginId)).toEqual(['java', 'vue3', 'fullstack']);
		expect(resolved.lock).toEqual({ java: '2.2.1', vue3: '1.5.0', fullstack: '1.3.0' });
		expect(resolved.billing.totalCents).toBe(0);
		expect(resolved.billing.dependencies.map((line) => line.pluginId)).toEqual(['java', 'vue3']);
	});

	it('付费依赖统一计费：主插件 + 未拥有的付费依赖；已拥有的不重复收费', () => {
		const lookup = lookupOf(
			plugin('fullstack', [{ version: '1.0.0', dependencies: [{ id: 'java', version: '^1.0.0' }] }], {
				licenseType: 'perpetual',
				priceCents: 9900
			}),
			plugin('java', [{ version: '1.0.0' }], { licenseType: 'perpetual', priceCents: 4900 })
		);
		const all = resolveDependencyGraph('fullstack', lookup);
		expect(all.ok).toBe(true);
		if (all.ok) {
			expect(all.billing.totalCents).toBe(9900 + 4900);
			expect(all.billing.principal.owned).toBe(false);
		}
		const owned = resolveDependencyGraph('fullstack', lookup, { ownedPluginIds: ['java'] });
		expect(owned.ok).toBe(true);
		if (owned.ok) {
			expect(owned.billing.totalCents).toBe(9900);
			expect(owned.billing.dependencies[0]!.owned).toBe(true);
		}
	});

	it('按安装次数授权：返回每次安装要消耗的次数', () => {
		const lookup = lookupOf(
			plugin('pack-root', [{ version: '1.0.0', dependencies: [{ id: 'pack-dep', version: '^1.0.0' }] }], {
				licenseType: 'install_pack',
				priceCents: 3000
			}),
			plugin('pack-dep', [{ version: '1.0.0' }], { licenseType: 'install_pack', priceCents: 1000 })
		);
		const resolved = resolveDependencyGraph('pack-root', lookup);
		expect(resolved.ok).toBe(true);
		if (resolved.ok) {
			expect(resolved.billing.perInstallConsumption).toEqual({ 'pack-root': 1, 'pack-dep': 1 });
		}
	});

	it('嵌套依赖递归展开（A → B → C），顺序为 C 先', () => {
		const lookup = lookupOf(
			plugin('a', [{ version: '1.0.0', dependencies: [{ id: 'b', version: '^1.0.0' }] }]),
			plugin('b', [{ version: '1.0.0', dependencies: [{ id: 'c', version: '^1.0.0' }] }]),
			plugin('c', [{ version: '1.0.0' }])
		);
		const resolved = resolveDependencyGraph('a', lookup);
		expect(resolved.ok).toBe(true);
		if (resolved.ok) expect(resolved.order.map((node) => node.pluginId)).toEqual(['c', 'b', 'a']);
	});

	it('环依赖 → cycle', () => {
		const lookup = lookupOf(
			plugin('a', [{ version: '1.0.0', dependencies: [{ id: 'b', version: '^1.0.0' }] }]),
			plugin('b', [{ version: '1.0.0', dependencies: [{ id: 'a', version: '^1.0.0' }] }])
		);
		const resolved = resolveDependencyGraph('a', lookup);
		expect(resolved.ok).toBe(false);
		if (!resolved.ok) expect(resolved.code).toBe('cycle');
	});

	it('版本冲突 / 无匹配版本 / 依赖缺失 / 可选依赖缺失', () => {
		const conflict = resolveDependencyGraph(
			'a',
			lookupOf(
				plugin('a', [
					{
						version: '1.0.0',
						dependencies: [
							{ id: 'b', version: '^2.0.0' },
							{ id: 'c', version: '^1.0.0' }
						]
					}
				]),
				plugin('b', [{ version: '2.0.0' }]),
				plugin('c', [{ version: '1.0.0', dependencies: [{ id: 'b', version: '^1.0.0' }] }])
			)
		);
		expect(conflict.ok).toBe(false);
		if (!conflict.ok) expect(conflict.code).toBe('version_conflict');

		const noMatch = resolveDependencyGraph('x', lookupOf(plugin('x', [{ version: '1.0.0' }])), {
			rootVersionRange: '^9.0.0'
		});
		expect(noMatch.ok).toBe(false);
		if (!noMatch.ok) expect(noMatch.code).toBe('no_matching_version');

		const missing = resolveDependencyGraph(
			'y',
			lookupOf(plugin('y', [{ version: '1.0.0', dependencies: [{ id: 'ghost', version: '^1.0.0' }] }]))
		);
		expect(missing.ok).toBe(false);
		if (!missing.ok) expect(missing.code).toBe('not_found');

		const optional = resolveDependencyGraph(
			'z',
			lookupOf(
				plugin('z', [
					{ version: '1.0.0', dependencies: [{ id: 'ghost', version: '^1.0.0', optional: true }] }
				])
			)
		);
		expect(optional.ok).toBe(true);
		if (optional.ok) expect(optional.warnings.length).toBe(1);
	});

	it('依赖层级上限 → limit', () => {
		const plugins: CatalogPlugin[] = [];
		for (let i = 0; i < 10; i++) {
			plugins.push(
				plugin(`p${i}`, [
					{
						version: '1.0.0',
						dependencies: i < 9 ? [{ id: `p${i + 1}`, version: '^1.0.0' }] : []
					}
				])
			);
		}
		const resolved = resolveDependencyGraph('p0', lookupOf(...plugins), { maxDepth: 3 });
		expect(resolved.ok).toBe(false);
		if (!resolved.ok) expect(resolved.code).toBe('limit');
	});
});
