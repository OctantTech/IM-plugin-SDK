import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
	ParamCryptoError,
	ParamSecretBox,
	Sm2Keyring,
	encryptSm2Payload,
	generateSm2KeyPair,
	loadParamKekFromEnv
} from './crypto';

const context = { entitlementId: 'entitlement-1', sourcePluginId: 'plugin-1', paramKey: 'appSecret' };

function kek(): Uint8Array {
	return new Uint8Array(randomBytes(32));
}

describe('SM2 传输加密（前端加密 → 服务端解密）', () => {
	it('公钥加密 / 私钥解密，载荷结构 + 时间窗校验', () => {
		const pair = generateSm2KeyPair();
		const keyring = new Sm2Keyring([{ keyId: 'k1', privateKey: pair.privateKey, publicKey: pair.publicKey }]);
		const cipher = encryptSm2Payload(pair.publicKey, {
			pluginId: 'com.example.feishu',
			key: 'appSecret',
			value: '超级机密'
		});
		const payload = keyring.decryptParamPayload(cipher);
		expect(payload.pluginId).toBe('com.example.feishu');
		expect(payload.key).toBe('appSecret');
		expect(payload.value).toBe('超级机密');
		expect(keyring.publicKeys().map((item) => item.keyId)).toEqual(['k1']);
	});

	it('过期时间戳拒绝；未知 keyId 拒绝；错误私钥解密失败', () => {
		const pair = generateSm2KeyPair();
		const other = generateSm2KeyPair();
		const keyring = new Sm2Keyring([{ keyId: 'k1', privateKey: pair.privateKey, publicKey: pair.publicKey }]);
		const stale = encryptSm2Payload(pair.publicKey, {
			pluginId: 'p',
			key: 'k',
			value: 'v',
			ts: Date.now() - 10 * 60 * 1000
		});
		expect(() => keyring.decryptParamPayload(stale)).toThrowError(ParamCryptoError);
		expect(() =>
			keyring.decryptParamPayload(encryptSm2Payload(other.publicKey, { pluginId: 'p', key: 'k', value: 'v' }), {
				keyId: 'k1'
			})
		).toThrowError(ParamCryptoError);
		expect(() =>
			keyring.decryptParamPayload(encryptSm2Payload(pair.publicKey, { pluginId: 'p', key: 'k', value: 'v' }), {
				keyId: 'missing'
			})
		).toThrowError(/unknown SM2 keyId/);
	});
});

describe('SM4-GCM 信封加密（落库）', () => {
	it('加密 → 解密往返；AAD 绑定 install/plugin/key', () => {
		const box = new ParamSecretBox(kek(), 'k1');
		const record = box.encrypt('appSecret=超级机密', context);
		expect(record.cipherAlg).toBe('sm4-gcm');
		expect(record.valueCipher).not.toContain('超级机密');
		expect(box.decrypt(record, context)).toBe('appSecret=超级机密');
		expect(box.decrypt(record, { ...context, entitlementId: 'other-entitlement' })).toBeNull();
		expect(box.decrypt(record, { ...context, sourcePluginId: 'other-plugin' })).toBeNull();
		expect(box.decrypt(record, { ...context, paramKey: 'other-key' })).toBeNull();
	});

	it('密文/tag 被篡改 → null；换 KEK 解不开', () => {
		const box = new ParamSecretBox(kek(), 'k1');
		const record = box.encrypt('secret', context);
		const [ct, tag] = record.valueCipher.split(':');
		const tampered = `${ct!.slice(0, -2)}${ct!.slice(-2) === '00' ? '01' : '00'}:${tag}`;
		expect(box.decrypt({ ...record, valueCipher: tampered }, context)).toBeNull();
		const otherBox = new ParamSecretBox(kek(), 'k2');
		expect(otherBox.decrypt(record, context)).toBeNull();
	});

	it('KEK 从环境变量读取（hex / base64），非法长度报错', () => {
		const raw = randomBytes(32);
		const hexValue = raw.toString('hex');
		expect(loadParamKekFromEnv({ PLUGIN_PARAM_KEK: hexValue, PLUGIN_PARAM_KEK_ID: 'k9' })).toMatchObject({
			keyId: 'k9'
		});
		expect(loadParamKekFromEnv({ PLUGIN_PARAM_KEK: raw.toString('base64') }).kek.length).toBe(32);
		expect(() => loadParamKekFromEnv({ PLUGIN_PARAM_KEK: 'short' })).toThrowError(ParamCryptoError);
		expect(() => loadParamKekFromEnv({})).toThrowError(/PLUGIN_PARAM_KEK/);
	});
});
