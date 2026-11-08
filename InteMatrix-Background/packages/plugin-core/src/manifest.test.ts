import { describe, expect, it } from 'vitest';
import {
	validatePackageFileName,
	validatePluginManifest,
	validateUnifiedPackageFileName,
	validateUnifiedPluginManifest
} from './manifest';

function basePro() {
	return {
		schemaVersion: 2,
		id: 'com.example.maven',
		kind: 'pro',
		version: '1.0.0',
		displayName: 'Maven 插件',
		dependencies: [{ id: 'com.example.git', version: '^1.0.0' }],
		params: [
			{ key: 'jdkVersion', label: 'JDK', type: 'select', kind: 'plain', options: ['17', '21'] },
			{ key: 'mavenSettings', label: 'settings.xml', type: 'textarea', kind: 'secret' }
		],
		permissions: {
			fs: 'codeRepo',
			exec: true,
			net: ['repo.maven.apache.org'],
			secrets: ['mavenSettings']
		},
		legal: {
			privacy: 'legal/privacy.md',
			terms: 'legal/terms.md',
			thirdParty: 'legal/third-party.md',
			collectsPersonalData: false,
			externalApis: []
		},
		install: { mode: 'script', script: 'install/install.sh' },
		scripts: { build: 'scripts/build.sh', verify: 'scripts/verify.sh' }
	};
}

function baseFast() {
	return {
		schemaVersion: 2,
		id: 'com.example.hello',
		kind: 'fast',
		version: '1.0.0',
		displayName: 'Hello Fast',
		dependencies: [],
		params: [{ key: 'apiToken', label: 'Token', kind: 'secret' }],
		permissions: { secrets: ['apiToken'] },
		legal: {
			privacy: 'legal/privacy.md',
			terms: 'legal/terms.md',
			thirdParty: 'legal/third-party.md'
		},
		scripts: { hello: 'scripts/hello.py' }
	};
}

describe('plugin.json v2 校验', () => {
	it('合法 Pro / Fast manifest 通过（含默认值填充）', () => {
		const pro = validatePluginManifest(basePro());
		expect(pro.ok).toBe(true);
		if (pro.ok) {
			expect(pro.manifest.install?.timeoutMs).toBe(15 * 60 * 1000);
			expect(pro.manifest.legal.collectsPersonalData).toBe(false);
		}
		const fast = validatePluginManifest(baseFast());
		expect(fast.ok).toBe(true);
	});

	it('Pro 缺 install / Fast 带 install 或 exec 或非 py/ts 脚本 → 拒绝', () => {
		const noInstall = basePro() as Record<string, unknown>;
		delete noInstall.install;
		expect(validatePluginManifest(noInstall).ok).toBe(false);

		const fastWithInstall = { ...baseFast(), install: { mode: 'script', script: 'install/x.sh' } };
		expect(validatePluginManifest(fastWithInstall).ok).toBe(false);

		const fastExec = { ...baseFast(), permissions: { exec: true, secrets: ['apiToken'] } };
		expect(validatePluginManifest(fastExec).ok).toBe(false);

		const fastShell = { ...baseFast(), scripts: { hello: 'scripts/hello.sh' } };
		expect(validatePluginManifest(fastShell).ok).toBe(false);
	});

	it('secret 参数必须在 permissions.secrets 声明；secret 不允许默认值', () => {
		const undeclared = baseFast();
		undeclared.permissions = { secrets: [] };
		expect(validatePluginManifest(undeclared).ok).toBe(false);

		const withDefault = baseFast();
		withDefault.params = [
			{ key: 'apiToken', label: 'Token', kind: 'secret', default: 'x' } as never
		];
		expect(validatePluginManifest(withDefault).ok).toBe(false);
	});

	it('法律文档必须放 legal/*.md；依赖不能依赖自己；semver 范围合法', () => {
		const badLegal = baseFast();
		badLegal.legal = { ...badLegal.legal, privacy: 'privacy.md' };
		expect(validatePluginManifest(badLegal).ok).toBe(false);

		const selfDep = baseFast();
		selfDep.dependencies = [{ id: 'com.example.hello', version: '^1.0.0' }] as never;
		expect(validatePluginManifest(selfDep).ok).toBe(false);

		const badRange = baseFast();
		badRange.dependencies = [{ id: 'com.example.x', version: 'not-a-range' }] as never;
		expect(validatePluginManifest(badRange).ok).toBe(false);
	});

	it('扩展名与 kind 必须一致', () => {
		expect(validatePackageFileName('demo.proplugin', 'pro').ok).toBe(true);
		expect(validatePackageFileName('demo.fastplugin', 'fast').ok).toBe(true);
		expect(validatePackageFileName('demo.fastplugin', 'pro').ok).toBe(false);
		expect(validatePackageFileName('demo.zip', 'fast').ok).toBe(false);
	});
});

function baseUnified() {
	return {
		schemaVersion: 4,
		id: 'com.intematrix.document-parser',
		version: '1.0.0',
		displayName: '文档解析',
		description: 'PDF/DOCX 解析',
		publisher: { type: 'official' },
		scope: 'project',
		dependencies: [{ id: 'com.intematrix.runtime.python', version: '^1.0.0' }],
		params: [{ key: 'apiToken', label: 'Token', kind: 'secret' }],
		permissions: { exec: true, net: [], secrets: ['apiToken'] },
		legal: {
			privacy: 'legal/privacy.md',
			terms: 'legal/terms.md',
			thirdParty: 'legal/third-party.md'
		},
		capabilities: {
			tools: [{ name: 'doc.parse_pdf', description: 'parse pdf' }],
			skills: [{ name: 'parse-documents', path: 'skills/parse.md', requires: ['runtime:python'] }],
			runtime: { id: 'python', version: '3.12' },
			hostApis: ['files', 'exec']
		}
	};
}

describe('plugin.json v4 统一插件', () => {
	it('通过且不再有 kind / fs 权限', () => {
		const result = validateUnifiedPluginManifest(baseUnified());
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.manifest.scope).toBe('project');
		expect(result.manifest.capabilities.tools[0]?.name).toBe('doc.parse_pdf');
		expect(result.manifest.capabilities.skills[0]?.requires).toContain('runtime:python');
		expect('kind' in result.manifest).toBe(false);
		expect('fs' in result.manifest.permissions).toBe(false);
	});

	it('拒绝 .proplugin / .fastplugin，只接受 .plugin', () => {
		expect(validateUnifiedPackageFileName('x.plugin').ok).toBe(true);
		expect(validateUnifiedPackageFileName('x.proplugin').ok).toBe(false);
		expect(validateUnifiedPackageFileName('x.fastplugin').ok).toBe(false);
	});

	it('仍校验 secret 声明与法律文档', () => {
		const badSecret = baseUnified();
		badSecret.permissions.secrets = [];
		expect(validateUnifiedPluginManifest(badSecret).ok).toBe(false);
		const badLegal = baseUnified();
		badLegal.legal.privacy = 'privacy.md';
		expect(validateUnifiedPluginManifest(badLegal).ok).toBe(false);
	});
});
