/**
 * `plugin.json` v2 校验（插件打包/上架/安装共用）。
 *
 * 纪律：
 *  - `.proplugin` ↔ `kind: "pro"`，`.fastplugin` ↔ `kind: "fast"`（扩展名与 kind 必须一致）；
 *  - Pro 必须声明 install（脚本或自带工具链）；Fast 不允许安装/toolchain，脚本仅 python/ts；
 *  - 必须有 PLUGIN.MD；必须声明 privacy / terms / third-party 三份法律文档；
 *  - 参数分 plain / secret：secret 不允许默认值，且必须出现在 permissions.secrets 里；
 *  - 依赖嵌套：dependencies 里声明 semver 范围，解析与 lock 在 dependencies.ts；
 *  - agent 永不安装插件：入口只有用户点击（安装动作由 web 触发，与 manifest 无关）。
 */
import { validRange } from 'semver';
import { z } from 'zod';

export const PLUGIN_KINDS = ['pro', 'fast'] as const;
export type PluginKind = (typeof PLUGIN_KINDS)[number];

export const PLUGIN_PACKAGE_EXTENSIONS: Record<PluginKind, string> = {
	pro: '.proplugin',
	fast: '.fastplugin'
};

const idPattern = /^[a-z0-9][a-z0-9._-]*$/;
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const hostnamePattern = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d+)?$/i;
const relativePathPattern = /^(?![./])(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;

export const pluginDependencySchema = z.object({
	id: z.string().regex(idPattern, 'dependency id 必须是小写字母/数字/._-'),
	version: z
		.string()
		.min(1)
		.refine((value) => validRange(value) !== null, 'dependency version 必须是合法 semver 范围'),
	optional: z.boolean().optional()
});

export const pluginParamSchema = z
	.object({
		key: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'param key 必须字母开头，仅字母/数字/下划线'),
		label: z.string().min(1).max(80),
		description: z.string().max(500).default(''),
		type: z
			.enum(['text', 'textarea', 'url', 'number', 'boolean', 'select', 'json'])
			.default('text'),
		kind: z.enum(['plain', 'secret']),
		required: z.boolean().default(false),
		default: z.string().max(2000).optional(),
		placeholder: z.string().max(200).optional(),
		options: z.array(z.string().max(200)).max(50).optional(),
		envKey: z
			.string()
			.regex(/^[A-Z][A-Z0-9_]*$/, 'envKey 必须是大写环境变量名')
			.optional()
	})
	.superRefine((param, ctx) => {
		if (param.kind === 'secret' && param.default !== undefined) {
			ctx.addIssue({ code: 'custom', message: 'secret 参数不允许默认值', path: ['default'] });
		}
		if (param.type === 'select' && (param.options?.length ?? 0) === 0) {
			ctx.addIssue({ code: 'custom', message: 'select 参数必须给 options', path: ['options'] });
		}
	});

export const pluginPermissionsSchema = z.object({
	fs: z.enum(['none', 'codeRepo']).default('none'),
	exec: z.boolean().default(false),
	net: z
		.array(z.string().regex(hostnamePattern, 'net 只允许主机名[:端口]，不要写协议'))
		.max(50)
		.default([]),
	secrets: z.array(z.string()).max(50).default([])
});

export const pluginLegalSchema = z.object({
	privacy: z.string().regex(relativePathPattern).default('legal/privacy.md'),
	terms: z.string().regex(relativePathPattern).default('legal/terms.md'),
	thirdParty: z.string().regex(relativePathPattern).default('legal/third-party.md'),
	collectsPersonalData: z.boolean().default(false),
	externalApis: z.array(z.string().url()).max(50).default([])
});

export const pluginInstallSchema = z
	.object({
		mode: z.enum(['script', 'bundle', 'script+bundle']),
		script: z.string().regex(relativePathPattern).optional(),
		bundle: z
			.object({
				path: z.string().regex(relativePathPattern),
				platforms: z.array(z.string().min(1)).min(1)
			})
			.optional(),
		verify: z.string().regex(relativePathPattern).optional(),
		timeoutMs: z
			.number()
			.int()
			.min(1000)
			.max(30 * 60 * 1000)
			.default(15 * 60 * 1000)
	})
	.superRefine((install, ctx) => {
		if (install.mode !== 'bundle' && !install.script) {
			ctx.addIssue({ code: 'custom', message: 'install 模式需要 script', path: ['script'] });
		}
		if (install.mode !== 'script' && !install.bundle) {
			ctx.addIssue({
				code: 'custom',
				message: 'install 模式需要 bundle/toolchain',
				path: ['bundle']
			});
		}
	});

export const pluginManifestSchema = z
	.object({
		schemaVersion: z.literal(2),
		id: z.string().min(3).max(120).regex(idPattern, 'id 必须是小写字母/数字/._-'),
		kind: z.enum(PLUGIN_KINDS),
		version: z.string().regex(semverPattern, 'version 必须是语义化版本'),
		displayName: z.string().min(1).max(80),
		description: z.string().max(500).default(''),
		longDescription: z.string().max(5000).default(''),
		icon: z
			.object({
				light: z.string().regex(relativePathPattern),
				dark: z.string().regex(relativePathPattern).optional()
			})
			.optional(),
		publisher: z
			.object({
				type: z.enum(['official', 'developer']).default('developer'),
				name: z.string().max(120).optional()
			})
			.default({ type: 'developer' }),
		compat: z
			.object({
				host: z.string().max(64).optional(),
				sandbox: z.string().max(64).optional()
			})
			.optional(),
		pluginMd: z.string().regex(relativePathPattern).default('PLUGIN.md'),
		dependencies: z.array(pluginDependencySchema).max(32).default([]),
		params: z.array(pluginParamSchema).max(64).default([]),
		permissions: pluginPermissionsSchema.default({
			fs: 'none',
			exec: false,
			net: [],
			secrets: []
		}),
		legal: pluginLegalSchema,
		/** Pro 专用：安装方法 / 自带工具链 / 健康检查。 */
		install: pluginInstallSchema.optional(),
		/** 脚本入口：Pro 常见 build/test/verify，Fast 只允许 python/ts。 */
		scripts: z.record(z.string().min(1).max(40), z.string().regex(relativePathPattern)).default({})
	})
	.superRefine((manifest, ctx) => {
		// kind 与能力边界
		if (manifest.kind === 'pro') {
			if (!manifest.install) {
				ctx.addIssue({ code: 'custom', message: 'Pro 插件必须声明 install', path: ['install'] });
			}
		} else {
			if (manifest.install) {
				ctx.addIssue({ code: 'custom', message: 'Fast 插件不允许 install', path: ['install'] });
			}
			if (manifest.permissions.exec) {
				ctx.addIssue({
					code: 'custom',
					message: 'Fast 插件不允许执行权限',
					path: ['permissions', 'exec']
				});
			}
			for (const [name, path] of Object.entries(manifest.scripts)) {
				if (!/\.(py|ts|mts|cts)$/.test(path)) {
					ctx.addIssue({
						code: 'custom',
						message: `Fast 脚 ${name} 只允许 python/ts`,
						path: ['scripts', name]
					});
				}
			}
		}

		// 参数唯一 + secret 声明一致
		const keys = new Set<string>();
		for (const [index, param] of manifest.params.entries()) {
			if (keys.has(param.key)) {
				ctx.addIssue({
					code: 'custom',
					message: `参数 key 重复：${param.key}`,
					path: ['params', index]
				});
			}
			keys.add(param.key);
			if (param.kind === 'secret' && !manifest.permissions.secrets.includes(param.key)) {
				ctx.addIssue({
					code: 'custom',
					message: `secret 参数 ${param.key} 必须声明在 permissions.secrets`,
					path: ['params', index]
				});
			}
		}
		for (const secret of manifest.permissions.secrets) {
			if (!manifest.params.some((param) => param.key === secret && param.kind === 'secret')) {
				ctx.addIssue({
					code: 'custom',
					message: `permissions.secrets 里的 ${secret} 没有对应 secret 参数`,
					path: ['permissions', 'secrets']
				});
			}
		}

		// 依赖：不能依赖自己、id 唯一
		const depIds = new Set<string>();
		for (const [index, dependency] of manifest.dependencies.entries()) {
			if (dependency.id === manifest.id) {
				ctx.addIssue({ code: 'custom', message: '不能依赖自己', path: ['dependencies', index] });
			}
			if (depIds.has(dependency.id)) {
				ctx.addIssue({
					code: 'custom',
					message: `依赖重复：${dependency.id}`,
					path: ['dependencies', index]
				});
			}
			depIds.add(dependency.id);
		}

		// 法律文档必须落在 legal/ 下
		for (const [name, path] of [
			['privacy', manifest.legal.privacy],
			['terms', manifest.legal.terms],
			['thirdParty', manifest.legal.thirdParty]
		] as const) {
			if (!path.startsWith('legal/') || !path.endsWith('.md')) {
				ctx.addIssue({
					code: 'custom',
					message: `${name} 必须是 legal/*.md`,
					path: ['legal', name]
				});
			}
		}
	});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type PluginParamDeclaration = z.infer<typeof pluginParamSchema>;
export type PluginDependencyDeclaration = z.infer<typeof pluginDependencySchema>;

export type ManifestValidationResult =
	{ ok: true; manifest: PluginManifest } | { ok: false; issues: string[] };

/** 校验 plugin.json（原始 JSON 对象）。 */
export function validatePluginManifest(raw: unknown): ManifestValidationResult {
	const parsed = pluginManifestSchema.safeParse(raw);
	if (parsed.success) return { ok: true, manifest: parsed.data };
	return {
		ok: false,
		issues: parsed.error.issues.map((issue) => {
			const path = issue.path.length ? issue.path.join('.') : '(root)';
			return `${path}: ${issue.message}`;
		})
	};
}

export function expectedPackageExtension(kind: PluginKind): string {
	return PLUGIN_PACKAGE_EXTENSIONS[kind];
}

/** 包文件名与 kind 必须匹配（防把 .proplugin 装进 Fast 槽）。 */
export function validatePackageFileName(
	fileName: string,
	kind: PluginKind
): { ok: true } | { ok: false; issue: string } {
	const expected = expectedPackageExtension(kind);
	if (!fileName.toLowerCase().endsWith(expected)) {
		return { ok: false, issue: `包文件名必须以 ${expected} 结尾（当前：${fileName}）` };
	}
	return { ok: true };
}

/* ───────────────────────────── 统一插件（v4） ───────────────────────────── */

/**
 * **sandbox 统一后的插件契约**：不再有 `kind: pro|fast`，统一 `.plugin` 包。
 * 执行能力由 capabilities 声明，由同一个 sandbox 执行；免费/付费只在授权层。
 *
 * v2 的 `validatePluginManifest` / `.proplugin` / `.fastplugin` 继续作为 legacy 兼容，
 * 新上架只接受本 schema。
 */
export const UNIFIED_PLUGIN_PACKAGE_EXTENSION = '.plugin';

export const unifiedPluginPermissionsSchema = z.object({
	exec: z.boolean().default(false),
	net: z
		.array(z.string().regex(hostnamePattern, 'net 只允许主机名[:端口]，不要写协议'))
		.max(50)
		.default([]),
	secrets: z.array(z.string()).max(50).default([])
});

export const unifiedPluginInstallSchema = z
	.object({
		mode: z.enum(['script', 'script+bundle']).default('script'),
		/** **统一插件必须有 install.sh**；这是宿主安装/准备环境的唯一入口。 */
		script: z
			.string()
			.regex(relativePathPattern)
			.refine((value) => value.endsWith('.sh'), '统一插件 install 脚本必须是 .sh'),
		bundle: z
			.object({
				path: z.string().regex(relativePathPattern),
				platforms: z.array(z.string().min(1)).min(1)
			})
			.optional(),
		verify: z.string().regex(relativePathPattern).optional(),
		timeoutMs: z
			.number()
			.int()
			.min(1000)
			.max(30 * 60 * 1000)
			.default(15 * 60 * 1000)
	})
	.superRefine((install, ctx) => {
		if (install.mode === 'script+bundle' && !install.bundle) {
			ctx.addIssue({ code: 'custom', message: 'script+bundle 需要 bundle', path: ['bundle'] });
		}
	});

export const unifiedPluginToolSchema = z.object({
	name: z.string().regex(/^[a-z][a-z0-9._-]*$/, 'tool name 必须小写字母/数字/._-'),
	displayName: z.string().min(1).max(80).optional(),
	description: z.string().max(2000).default(''),
	inputSchema: z.record(z.string(), z.unknown()).optional(),
	aliases: z.array(z.string().min(1).max(120)).max(20).default([]),
	/** 插件内可执行入口（相对插件根），由 sandbox 执行；P4 工具执行器读取。 */
	entry: z.string().regex(relativePathPattern).optional(),
	/** 入口运行时；缺省按扩展名推断。 */
	runtime: z.enum(['node', 'bun', 'python', 'shell']).optional(),
	/** 单次执行超时。 */
	timeoutMs: z
		.number()
		.int()
		.min(1000)
		.max(30 * 60 * 1000)
		.optional()
});

export const unifiedPluginSkillSchema = z.object({
	name: z.string().regex(/^[a-z][a-z0-9._-]*$/, 'skill name 必须小写字母/数字/._-'),
	description: z.string().max(1000).default(''),
	path: z.string().regex(relativePathPattern),
	requires: z.array(z.string().min(1).max(160)).max(20).default([])
});

export const unifiedPluginHookSchema = z.object({
	name: z.string().regex(/^[a-z][a-z0-9._-]*$/),
	event: z.enum(['install', 'uninstall', 'before_tool', 'after_tool']),
	entry: z.string().regex(relativePathPattern),
	runtime: z.enum(['node', 'bun', 'python', 'shell']).optional(),
	timeoutMs: z
		.number()
		.int()
		.min(1000)
		.max(30 * 60 * 1000)
		.optional()
});

export const unifiedPluginRuntimeSchema = z.object({
	id: z.string().regex(/^[a-z][a-z0-9._-]*$/),
	version: z.string().min(1).max(80),
	install: z.string().regex(relativePathPattern).optional(),
	verify: z.string().regex(relativePathPattern).optional(),
	/** 验收命令：安装后必须能执行（例如 `python3 --version`）。 */
	testCommand: z.string().min(1).max(300).optional()
});

export const unifiedPluginCapabilitiesSchema = z
	.object({
		tools: z.array(unifiedPluginToolSchema).max(64).default([]),
		skills: z.array(unifiedPluginSkillSchema).max(64).default([]),
		hooks: z.array(unifiedPluginHookSchema).max(64).default([]),
		runtime: unifiedPluginRuntimeSchema.optional(),
		provider: z.record(z.string(), z.unknown()).optional(),
		hostApis: z
			.array(z.enum(['files', 'exec', 'secrets', 'apiKeys', 'events', 'runtime']))
			.max(20)
			.default([])
	})
	.default({ tools: [], skills: [], hooks: [], hostApis: [] });

export const unifiedPluginManifestSchema = z
	.object({
		schemaVersion: z.literal(4),
		id: z.string().min(3).max(120).regex(idPattern, 'id 必须是小写字母/数字/._-'),
		version: z.string().regex(semverPattern, 'version 必须是语义化版本'),
		displayName: z.string().min(1).max(80),
		description: z.string().max(500).default(''),
		longDescription: z.string().max(5000).default(''),
		icon: z
			.object({
				light: z.string().regex(relativePathPattern),
				dark: z.string().regex(relativePathPattern).optional()
			})
			.optional(),
		publisher: z
			.object({
				type: z.enum(['official', 'developer']).default('developer'),
				name: z.string().max(120).optional()
			})
			.default({ type: 'developer' }),
		/** 授权/定价层（与插件类型无关）：官方环境/数据插件必须 free。 */
		pricing: z
			.object({
				model: z.enum(['free', 'paid']).default('free'),
				note: z.string().max(500).default('')
			})
			.default({ model: 'free', note: '' }),
		/** 安装范围；provider 等用户级能力用 user。 */
		scope: z.enum(['project', 'user']).default('project'),
		compat: z
			.object({ host: z.string().max(64).optional(), sandbox: z.string().max(64).optional() })
			.optional(),
		pluginMd: z.string().regex(relativePathPattern).default('PLUGIN.md'),
		dependencies: z.array(pluginDependencySchema).max(32).default([]),
		params: z.array(pluginParamSchema).max(64).default([]),
		permissions: unifiedPluginPermissionsSchema.default({ exec: false, net: [], secrets: [] }),
		legal: pluginLegalSchema,
		/** 统一插件一律要求 install.sh，不再有“无安装”插件。 */
		install: unifiedPluginInstallSchema,
		scripts: z.record(z.string().min(1).max(40), z.string().regex(relativePathPattern)).default({}),
		capabilities: unifiedPluginCapabilitiesSchema
	})
	.superRefine((manifest, ctx) => {
		const keys = new Set<string>();
		for (const [index, param] of manifest.params.entries()) {
			if (keys.has(param.key)) {
				ctx.addIssue({
					code: 'custom',
					message: `参数 key 重复：${param.key}`,
					path: ['params', index]
				});
			}
			keys.add(param.key);
			if (param.kind === 'secret' && !manifest.permissions.secrets.includes(param.key)) {
				ctx.addIssue({
					code: 'custom',
					message: `secret 参数 ${param.key} 必须声明在 permissions.secrets`,
					path: ['params', index]
				});
			}
		}
		for (const secret of manifest.permissions.secrets) {
			if (!manifest.params.some((param) => param.key === secret && param.kind === 'secret')) {
				ctx.addIssue({
					code: 'custom',
					message: `permissions.secrets 里的 ${secret} 没有对应 secret 参数`,
					path: ['permissions', 'secrets']
				});
			}
		}
		const depIds = new Set<string>();
		for (const [index, dependency] of manifest.dependencies.entries()) {
			if (dependency.id === manifest.id) {
				ctx.addIssue({ code: 'custom', message: '不能依赖自己', path: ['dependencies', index] });
			}
			if (depIds.has(dependency.id)) {
				ctx.addIssue({
					code: 'custom',
					message: `依赖重复：${dependency.id}`,
					path: ['dependencies', index]
				});
			}
			depIds.add(dependency.id);
		}
		for (const [name, path] of [
			['privacy', manifest.legal.privacy],
			['terms', manifest.legal.terms],
			['thirdParty', manifest.legal.thirdParty]
		] as const) {
			if (!path.startsWith('legal/') || !path.endsWith('.md')) {
				ctx.addIssue({
					code: 'custom',
					message: `${name} 必须是 legal/*.md`,
					path: ['legal', name]
				});
			}
		}
	});

export type UnifiedPluginManifest = z.infer<typeof unifiedPluginManifestSchema>;

export type UnifiedManifestValidationResult =
	{ ok: true; manifest: UnifiedPluginManifest } | { ok: false; issues: string[] };

export function validateUnifiedPluginManifest(raw: unknown): UnifiedManifestValidationResult {
	const parsed = unifiedPluginManifestSchema.safeParse(raw);
	if (parsed.success) return { ok: true, manifest: parsed.data };
	return {
		ok: false,
		issues: parsed.error.issues.map((issue) => {
			const path = issue.path.length ? issue.path.join('.') : '(root)';
			return `${path}: ${issue.message}`;
		})
	};
}

/** `.plugin` 文件名校验（v4 统一包）。 */
export function validateUnifiedPackageFileName(
	fileName: string
): { ok: true } | { ok: false; issue: string } {
	if (!fileName.toLowerCase().endsWith(UNIFIED_PLUGIN_PACKAGE_EXTENSION)) {
		return {
			ok: false,
			issue: `统一插件包必须以 ${UNIFIED_PLUGIN_PACKAGE_EXTENSION} 结尾（当前：${fileName}）`
		};
	}
	return { ok: true };
}
