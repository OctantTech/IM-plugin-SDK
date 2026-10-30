/**
 * 密文参数加密：**SM2（传输）+ SM4-GCM（落库，信封加密）**。
 *
 * 链路：
 *   1. 前端拿到 SM2 公钥（带 keyId），把 `{pluginId, key, value, ts}` 用 SM2 加密后提交；
 *   2. 服务端用私钥解密（只支持当前 + 上一个 keyId，支持轮换），得到明文；
 *   3. 落库前用信封加密：随机 DEK 加密值（SM4-GCM），DEK 再用 KEK（环境变量/KMS）包裹；
 *   4. 读取时先解包 DEK 再解值；AAD 绑定 install / plugin / key，防止密文被挪用到别处。
 *
 * 存储字段：
 *   valueCipher = `${ctHex}:${tagHex}`
 *   cipherIv    = 12 字节 IV（hex）
 *   dekWrapped  = `${wrapIvHex}:${wrapCtHex}:${wrapTagHex}`
 */
import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { sm2, sm3 } from 'sm-crypto';
import { sm4GcmDecrypt, sm4GcmEncrypt } from './sm4';

export const PARAM_CIPHER_ALG = 'sm4-gcm';
export const SM2_ALG = 'SM2';

export class ParamCryptoError extends Error {
	constructor(
		message: string,
		readonly code:
			| 'invalid_key'
			| 'decrypt_failed'
			| 'envelope_invalid'
			| 'tag_mismatch'
			| 'stale_timestamp'
	) {
		super(message);
		this.name = 'ParamCryptoError';
	}
}

function hex(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('hex');
}

function fromHex(value: string): Uint8Array {
	if (!/^[0-9a-fA-F]*$/.test(value) || value.length % 2 !== 0) {
		throw new ParamCryptoError('invalid hex payload', 'invalid_key');
	}
	return new Uint8Array(Buffer.from(value, 'hex'));
}

function randomBytes(length: number): Uint8Array {
	return new Uint8Array(nodeRandomBytes(length));
}

/** SM2 公钥信息（前端加密用）。 */
export interface Sm2PublicKeyInfo {
	alg: typeof SM2_ALG;
	keyId: string;
	publicKey: string;
	staleAfter?: string;
}

/** 服务端密钥环：当前私钥 + 可选的上一把（轮换窗口）。 */
export class Sm2Keyring {
	private readonly keys: Array<{ keyId: string; privateKey: string; publicKey: string }>;

	constructor(
		keys: Array<{ keyId: string; privateKey: string; publicKey?: string }>,
		private readonly activeKeyId = keys[0]?.keyId
	) {
		if (keys.length === 0) throw new ParamCryptoError('SM2 keyring is empty', 'invalid_key');
		this.keys = keys.map((entry) => ({
			keyId: entry.keyId,
			privateKey: entry.privateKey,
			publicKey: entry.publicKey ?? sm2.getPublicKeyFromPrivateKey(entry.privateKey)
		}));
	}

	/** 前端可拉取的公钥列表（当前在前）。 */
	publicKeys(): Sm2PublicKeyInfo[] {
		return this.keys.map((entry) => ({ alg: SM2_ALG, keyId: entry.keyId, publicKey: entry.publicKey }));
	}

	private keyFor(keyId?: string) {
		if (!keyId) return this.keys[0]!;
		const found = this.keys.find((entry) => entry.keyId === keyId);
		if (!found) throw new ParamCryptoError(`unknown SM2 keyId: ${keyId}`, 'invalid_key');
		return found;
	}

	/** 服务端解密前端提交的 SM2 密文（返回原始明文串）。 */
	decrypt(ciphertextHex: string, keyId?: string): string {
		const key = this.keyFor(keyId);
		try {
			return sm2.doDecrypt(ciphertextHex, key.privateKey, 1);
		} catch {
			throw new ParamCryptoError('SM2 decrypt failed', 'decrypt_failed');
		}
	}

	/** 解密并校验载荷结构 + 时间窗（防重放的时间半部分；nonce 由 API 层用 Redis 校验）。 */
	decryptParamPayload(
		ciphertextHex: string,
		options: { keyId?: string; now?: number; ttlMs?: number } = {}
	): { pluginId: string; key: string; value: string; ts: number } {
		const raw = this.decrypt(ciphertextHex, options.keyId);
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			throw new ParamCryptoError('SM2 payload is not JSON', 'decrypt_failed');
		}
		const payload = parsed as Partial<{ pluginId: string; key: string; value: string; ts: number }>;
		if (
			typeof payload.pluginId !== 'string' ||
			typeof payload.key !== 'string' ||
			typeof payload.value !== 'string' ||
			typeof payload.ts !== 'number'
		) {
			throw new ParamCryptoError('SM2 payload shape invalid', 'envelope_invalid');
		}
		assertFreshTimestamp(payload.ts, options.now, options.ttlMs);
		return { pluginId: payload.pluginId, key: payload.key, value: payload.value, ts: payload.ts };
	}
}

/** 前端/工具侧：用公钥加密参数载荷（测试与本地联调共用）。 */
export function encryptSm2Payload(
	publicKey: string,
	payload: { pluginId: string; key: string; value: string; ts?: number }
): string {
	return sm2.doEncrypt(
		JSON.stringify({ ...payload, ts: payload.ts ?? Date.now() }),
		publicKey,
		1
	);
}

/** 生成一对 SM2 密钥（部署脚本用）。 */
export function generateSm2KeyPair(): { privateKey: string; publicKey: string } {
	return sm2.generateKeyPairHex();
}

/** 时间窗校验：默认 ±2 分钟。 */
export function assertFreshTimestamp(
	ts: number,
	now: number = Date.now(),
	ttlMs: number = 2 * 60 * 1000
): void {
	if (!Number.isFinite(ts) || Math.abs(now - ts) > ttlMs) {
		throw new ParamCryptoError('timestamp outside allowed window', 'stale_timestamp');
	}
}

/** 信封加密后的存储字段（对应 plugin_params 表）。 */
export interface SecretEnvelopeRecord {
	valueCipher: string;
	cipherAlg: typeof PARAM_CIPHER_ALG;
	cipherKeyId: string;
	cipherIv: string;
	dekWrapped: string;
}

export interface SecretAadContext {
	installId: string;
	sourcePluginId: string;
	paramKey: string;
}

/** 从 32 字节 KEK 派生 SM4 会话密钥（SM3 哈希，取前 16 字节）。 */
export function deriveSm4Key(kek: Uint8Array, label: string): Uint8Array {
	if (kek.length !== 32) throw new ParamCryptoError('KEK must be 32 bytes', 'invalid_key');
	const digest = sm3([...kek, ...new TextEncoder().encode(label)]);
	return fromHex(digest.slice(0, 32));
}

function aadFor(context: SecretAadContext): Uint8Array {
	return new TextEncoder().encode(
		`plugin:param:v1|install=${context.installId}|plugin=${context.sourcePluginId}|key=${context.paramKey}`
	);
}

function wrapAad(keyId: string): Uint8Array {
	return new TextEncoder().encode(`plugin:dek-wrap:v1|key=${keyId}`);
}

/** 读取 KEK：`PLUGIN_PARAM_KEK`（32 字节 hex 或 base64），`PLUGIN_PARAM_KEK_ID` 默认 k1。 */
export function loadParamKekFromEnv(env: Record<string, string | undefined> = process.env): {
	kek: Uint8Array;
	keyId: string;
} {
	const raw = env.PLUGIN_PARAM_KEK?.trim();
	if (!raw) throw new ParamCryptoError('PLUGIN_PARAM_KEK is not configured', 'invalid_key');
	let kek: Uint8Array;
	if (/^[0-9a-fA-F]{64}$/.test(raw)) kek = fromHex(raw);
	else {
		const decoded = new Uint8Array(Buffer.from(raw, 'base64'));
		kek = decoded;
	}
	if (kek.length !== 32) {
		throw new ParamCryptoError('PLUGIN_PARAM_KEK must decode to 32 bytes', 'invalid_key');
	}
	return { kek, keyId: env.PLUGIN_PARAM_KEK_ID?.trim() || 'k1' };
}

/** 信封加密盒：值用随机 DEK 加密，DEK 用 KEK 包裹。 */
export class ParamSecretBox {
	constructor(
		private readonly kek: Uint8Array,
		private readonly keyId: string
	) {
		if (kek.length !== 32) throw new ParamCryptoError('KEK must be 32 bytes', 'invalid_key');
	}

	encrypt(plaintext: string, context: SecretAadContext): SecretEnvelopeRecord {
		const dek = randomBytes(16);
		const valueIv = randomBytes(12);
		const { ciphertext, tag } = sm4GcmEncrypt(
			dek,
			valueIv,
			new TextEncoder().encode(plaintext),
			aadFor(context)
		);
		const wrapIv = randomBytes(12);
		const wrapped = sm4GcmEncrypt(
			deriveSm4Key(this.kek, `dek-wrap:${this.keyId}`),
			wrapIv,
			dek,
			wrapAad(this.keyId)
		);
		return {
			valueCipher: `${hex(ciphertext)}:${hex(tag)}`,
			cipherAlg: PARAM_CIPHER_ALG,
			cipherKeyId: this.keyId,
			cipherIv: hex(valueIv),
			dekWrapped: `${hex(wrapIv)}:${hex(wrapped.ciphertext)}:${hex(wrapped.tag)}`
		};
	}

	/** 解密；tag 不匹配 / 结构损坏 → null（调用方给统一错误，不泄露细节）。 */
	decrypt(record: SecretEnvelopeRecord, context: SecretAadContext): string | null {
		if (record.cipherAlg !== PARAM_CIPHER_ALG) return null;
		try {
			const [valueCtHex, valueTagHex] = record.valueCipher.split(':');
			const [wrapIvHex, wrapCtHex, wrapTagHex] = record.dekWrapped.split(':');
			if (!valueCtHex || !valueTagHex || !wrapIvHex || !wrapCtHex || !wrapTagHex) return null;
			const dek = sm4GcmDecrypt(
				deriveSm4Key(this.kek, `dek-wrap:${record.cipherKeyId}`),
				fromHex(wrapIvHex),
				fromHex(wrapCtHex),
				fromHex(wrapTagHex),
				wrapAad(record.cipherKeyId)
			);
			if (!dek) return null;
			const plaintext = sm4GcmDecrypt(
				dek,
				fromHex(record.cipherIv),
				fromHex(valueCtHex),
				fromHex(valueTagHex),
				aadFor(context)
			);
			return plaintext ? new TextDecoder().decode(plaintext) : null;
		} catch {
			return null;
		}
	}
}
