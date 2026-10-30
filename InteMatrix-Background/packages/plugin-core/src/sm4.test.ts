import { describe, expect, it } from 'vitest';
import { createCipheriv, createDecipheriv } from 'node:crypto';
import {
	gcmDecrypt,
	gcmEncrypt,
	sm4DecryptBlock,
	sm4EncryptBlock,
	sm4GcmDecrypt,
	sm4GcmEncrypt
} from './sm4';

function hex(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('hex');
}

function fromHex(value: string): Uint8Array {
	return new Uint8Array(Buffer.from(value, 'hex'));
}

describe('SM4 分组密码（国标向量）', () => {
	it('GB/T 32907 标准向量：单分组加密/解密', () => {
		const key = fromHex('0123456789abcdeffedcba9876543210');
		const plain = fromHex('0123456789abcdeffedcba9876543210');
		const cipher = sm4EncryptBlock(key, plain);
		expect(hex(cipher)).toBe('681edf34d206965e86b3e94f536e4246');
		expect(hex(sm4DecryptBlock(key, cipher))).toBe(hex(plain));
	});
});

describe('GCM（用 AES-128 交叉验证 GHASH/CTR 实现）', () => {
	function aesEncryptor(key: Uint8Array) {
		return (block: Uint8Array) => {
			const cipher = createCipheriv('aes-128-ecb', key, null);
			cipher.setAutoPadding(false);
			return new Uint8Array(Buffer.concat([cipher.update(Buffer.from(block)), cipher.final()]));
		};
	}

	it('NIST 向量：空明文 tag', () => {
		const key = new Uint8Array(16);
		const iv = new Uint8Array(12);
		const { tag } = gcmEncrypt(aesEncryptor(key), iv, new Uint8Array());
		expect(hex(tag)).toBe('58e2fccefa7e3061367f1d57a4e7455a');
	});

	it('NIST 向量：16 字节明文 ciphertext/tag', () => {
		const key = new Uint8Array(16);
		const iv = new Uint8Array(12);
		const plain = new Uint8Array(16);
		const { ciphertext, tag } = gcmEncrypt(aesEncryptor(key), iv, plain);
		expect(hex(ciphertext)).toBe('0388dace60b6a392f328c2b971b2fe78');
		expect(hex(tag)).toBe('ab6e47d42cec13bdf53a67b21257bddf');
		const decrypted = gcmDecrypt(aesEncryptor(key), iv, ciphertext, tag);
		expect(decrypted ? hex(decrypted) : null).toBe(hex(plain));
	});

	it('SM4-GCM：往返 + 篡改检测 + AAD', () => {
		const key = fromHex('0123456789abcdeffedcba9876543210');
		const iv = fromHex('000102030405060708090a0b');
		const aad = new TextEncoder().encode('plugin:param:v1');
		const message = new TextEncoder().encode('appSecret=超级机密');
		const { ciphertext, tag } = sm4GcmEncrypt(key, iv, message, aad);
		expect(hex(ciphertext)).not.toBe(hex(message));
		const decrypted = sm4GcmDecrypt(key, iv, ciphertext, tag, aad);
		expect(decrypted ? new TextDecoder().decode(decrypted) : null).toBe('appSecret=超级机密');
		// 篡改一个字节 → tag 校验失败
		const tampered = ciphertext.slice();
		tampered[0] ^= 0xff;
		expect(sm4GcmDecrypt(key, iv, tampered, tag, aad)).toBeNull();
		// AAD 不一致 → 失败
		expect(sm4GcmDecrypt(key, iv, ciphertext, tag, new TextEncoder().encode('other'))).toBeNull();
	});
});
