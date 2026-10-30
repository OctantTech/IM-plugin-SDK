/**
 * SM4 分组密码（GB/T 32907-2016）+ GCM 模式。
 *
 * 为什么自己实现：运行时（Bun/Node 的 OpenSSL）不带 `sm4-gcm`，而密文参数明确要求
 * **SM2（传输）+ SM4-GCM（落库）**；这里只实现分组加密 + GCM，不引入原生依赖，
 * 服务端与测试共用同一实现，并用国标向量 + NIST GCM 向量双向校验。
 */

const SBOX = new Uint8Array([
	0xd6, 0x90, 0xe9, 0xfe, 0xcc, 0xe1, 0x3d, 0xb7, 0x16, 0xb6, 0x14, 0xc2, 0x28, 0xfb, 0x2c, 0x05,
	0x2b, 0x67, 0x9a, 0x76, 0x2a, 0xbe, 0x04, 0xc3, 0xaa, 0x44, 0x13, 0x26, 0x49, 0x86, 0x06, 0x99,
	0x9c, 0x42, 0x50, 0xf4, 0x91, 0xef, 0x98, 0x7a, 0x33, 0x54, 0x0b, 0x43, 0xed, 0xcf, 0xac, 0x62,
	0xe4, 0xb3, 0x1c, 0xa9, 0xc9, 0x08, 0xe8, 0x95, 0x80, 0xdf, 0x94, 0xfa, 0x75, 0x8f, 0x3f, 0xa6,
	0x47, 0x07, 0xa7, 0xfc, 0xf3, 0x73, 0x17, 0xba, 0x83, 0x59, 0x3c, 0x19, 0xe6, 0x85, 0x4f, 0xa8,
	0x68, 0x6b, 0x81, 0xb2, 0x71, 0x64, 0xda, 0x8b, 0xf8, 0xeb, 0x0f, 0x4b, 0x70, 0x56, 0x9d, 0x35,
	0x1e, 0x24, 0x0e, 0x5e, 0x63, 0x58, 0xd1, 0xa2, 0x25, 0x22, 0x7c, 0x3b, 0x01, 0x21, 0x78, 0x87,
	0xd4, 0x00, 0x46, 0x57, 0x9f, 0xd3, 0x27, 0x52, 0x4c, 0x36, 0x02, 0xe7, 0xa0, 0xc4, 0xc8, 0x9e,
	0xea, 0xbf, 0x8a, 0xd2, 0x40, 0xc7, 0x38, 0xb5, 0xa3, 0xf7, 0xf2, 0xce, 0xf9, 0x61, 0x15, 0xa1,
	0xe0, 0xae, 0x5d, 0xa4, 0x9b, 0x34, 0x1a, 0x55, 0xad, 0x93, 0x32, 0x30, 0xf5, 0x8c, 0xb1, 0xe3,
	0x1d, 0xf6, 0xe2, 0x2e, 0x82, 0x66, 0xca, 0x60, 0xc0, 0x29, 0x23, 0xab, 0x0d, 0x53, 0x4e, 0x6f,
	0xd5, 0xdb, 0x37, 0x45, 0xde, 0xfd, 0x8e, 0x2f, 0x03, 0xff, 0x6a, 0x72, 0x6d, 0x6c, 0x5b, 0x51,
	0x8d, 0x1b, 0xaf, 0x92, 0xbb, 0xdd, 0xbc, 0x7f, 0x11, 0xd9, 0x5c, 0x41, 0x1f, 0x10, 0x5a, 0xd8,
	0x0a, 0xc1, 0x31, 0x88, 0xa5, 0xcd, 0x7b, 0xbd, 0x2d, 0x74, 0xd0, 0x12, 0xb8, 0xe5, 0xb4, 0xb0,
	0x89, 0x69, 0x97, 0x4a, 0x0c, 0x96, 0x77, 0x7e, 0x65, 0xb9, 0xf1, 0x09, 0xc5, 0x6e, 0xc6, 0x84,
	0x18, 0xf0, 0x7d, 0xec, 0x3a, 0xdc, 0x4d, 0x20, 0x79, 0xee, 0x5f, 0x3e, 0xd7, 0xcb, 0x39, 0x48
]);

const FK = [0xa3b1bac6, 0x56aa3350, 0x677d9197, 0xb27022dc];

// 国标：CK_ij = (4i + j) * 7 mod 256（j = 0..3），按大端拼成 32 位常量。
const CK = new Uint32Array(32);
for (let i = 0; i < 32; i++) {
	const b = [4 * i, 4 * i + 1, 4 * i + 2, 4 * i + 3].map((value) => (value * 7) % 256);
	CK[i] = (((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0);
}

function rotl(x: number, n: number): number {
	return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function tau(x: number): number {
	return (
		((SBOX[(x >>> 24) & 0xff]! << 24) |
			(SBOX[(x >>> 16) & 0xff]! << 16) |
			(SBOX[(x >>> 8) & 0xff]! << 8) |
			SBOX[x & 0xff]!) >>>
		0
	);
}

function t(x: number): number {
	const b = tau(x);
	return (b ^ rotl(b, 2) ^ rotl(b, 10) ^ rotl(b, 18) ^ rotl(b, 24)) >>> 0;
}

function tPrime(x: number): number {
	const b = tau(x);
	return (b ^ rotl(b, 13) ^ rotl(b, 23)) >>> 0;
}

function readU32BE(bytes: Uint8Array, offset: number): number {
	return (
		((bytes[offset]! << 24) |
			(bytes[offset + 1]! << 16) |
			(bytes[offset + 2]! << 8) |
			bytes[offset + 3]!) >>>
		0
	);
}

function writeU32BE(bytes: Uint8Array, offset: number, value: number): void {
	bytes[offset] = (value >>> 24) & 0xff;
	bytes[offset + 1] = (value >>> 16) & 0xff;
	bytes[offset + 2] = (value >>> 8) & 0xff;
	bytes[offset + 3] = value & 0xff;
}

export function sm4KeySchedule(key: Uint8Array): Uint32Array {
	if (key.length !== 16) throw new Error('SM4 key must be 16 bytes');
	const rk = new Uint32Array(32);
	const k = new Uint32Array(4);
	for (let i = 0; i < 4; i++) k[i] = readU32BE(key, i * 4) ^ FK[i]!;
	let tmp = k;
	for (let i = 0; i < 32; i++) {
		const next = (tmp[i % 4]! ^ tPrime(tmp[(i + 1) % 4]! ^ tmp[(i + 2) % 4]! ^ tmp[(i + 3) % 4]! ^ CK[i]!)) >>> 0;
		rk[i] = next;
		tmp[i % 4] = next;
	}
	return rk;
}

function cryptBlock(rk: Uint32Array, block: Uint8Array, decrypt: boolean): Uint8Array {
	if (block.length !== 16) throw new Error('SM4 block must be 16 bytes');
	const x = new Uint32Array(36);
	for (let i = 0; i < 4; i++) x[i] = readU32BE(block, i * 4);
	for (let i = 0; i < 32; i++) {
		const key = decrypt ? rk[31 - i]! : rk[i]!;
		x[i + 4] =
			(x[i]! ^ t(x[i + 1]! ^ x[i + 2]! ^ x[i + 3]! ^ key)) >>> 0;
	}
	const out = new Uint8Array(16);
	for (let i = 0; i < 4; i++) writeU32BE(out, i * 4, x[35 - i]!);
	return out;
}

export function sm4EncryptBlock(key: Uint8Array, block: Uint8Array): Uint8Array {
	return cryptBlock(sm4KeySchedule(key), block, false);
}

export function sm4DecryptBlock(key: Uint8Array, block: Uint8Array): Uint8Array {
	return cryptBlock(sm4KeySchedule(key), block, true);
}

/* ── GCM（通用：传入 16 字节分组加密函数） ─────────────────────────────── */

type BlockCipher = (block: Uint8Array) => Uint8Array;

function ghashMul(x: Uint8Array, y: Uint8Array): Uint8Array {
	const a = new Uint32Array(4);
	const b = new Uint32Array(4);
	for (let i = 0; i < 4; i++) {
		a[i] = readU32BE(x, i * 4);
		b[i] = readU32BE(y, i * 4);
	}
	const z = new Uint32Array(4);
	const v = new Uint32Array(4);
	v.set(b);
	for (let i = 0; i < 128; i++) {
		const bit = (a[Math.floor(i / 32)]! >>> (31 - (i % 32))) & 1;
		if (bit) {
			z[0] ^= v[0]!;
			z[1] ^= v[1]!;
			z[2] ^= v[2]!;
			z[3] ^= v[3]!;
		}
		const lsb = v[3]! & 1;
		v[3] = (v[3]! >>> 1) | ((v[2]! & 1) << 31);
		v[2] = (v[2]! >>> 1) | ((v[1]! & 1) << 31);
		v[1] = (v[1]! >>> 1) | ((v[0]! & 1) << 31);
		v[0] = v[0]! >>> 1;
		if (lsb) v[0] ^= 0xe1000000;
	}
	const out = new Uint8Array(16);
	for (let i = 0; i < 4; i++) writeU32BE(out, i * 4, z[i]! >>> 0);
	return out;
}

function ghash(h: Uint8Array, aad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
	let y: Uint8Array = new Uint8Array(16);
	const feed = (data: Uint8Array) => {
		for (let offset = 0; offset < data.length; offset += 16) {
			const block = new Uint8Array(16);
			const chunk = data.subarray(offset, Math.min(offset + 16, data.length));
			for (let i = 0; i < chunk.length; i++) block[i] = chunk[i]!;
			for (let i = 0; i < 16; i++) block[i] ^= y[i]!;
			y = ghashMul(block, h);
		}
	};
	feed(aad);
	feed(ciphertext);
	const lens = new Uint8Array(16);
	const aadBits = BigInt(aad.length) * 8n;
	const ctBits = BigInt(ciphertext.length) * 8n;
	for (let i = 0; i < 8; i++) lens[7 - i] = Number((aadBits >> BigInt(i * 8)) & 0xffn);
	for (let i = 0; i < 8; i++) lens[15 - i] = Number((ctBits >> BigInt(i * 8)) & 0xffn);
	for (let i = 0; i < 16; i++) lens[i] ^= y[i]!;
	return ghashMul(lens, h);
}

function inc32(counter: Uint8Array): void {
	for (let i = 15; i >= 12; i--) {
		counter[i] = (counter[i]! + 1) & 0xff;
		if (counter[i] !== 0) break;
	}
}

function xorInto(target: Uint8Array, value: Uint8Array): void {
	for (let i = 0; i < target.length; i++) target[i] ^= value[i]!;
}

/**
 * GCM 加密。`iv` 建议 96 位；返回 ciphertext + 16 字节 tag。
 */
export function gcmEncrypt(
	encryptBlock: BlockCipher,
	iv: Uint8Array,
	plaintext: Uint8Array,
	aad: Uint8Array = new Uint8Array()
): { ciphertext: Uint8Array; tag: Uint8Array } {
	const h = encryptBlock(new Uint8Array(16));
	const j0 = new Uint8Array(16);
	if (iv.length === 12) {
		j0.set(iv);
		j0[15] = 1;
	} else {
		// 非 96 位 IV：J0 = GHASH(IV || pad || len)
		const padded = new Uint8Array(Math.ceil(iv.length / 16) * 16 + 16);
		padded.set(iv);
		const bits = BigInt(iv.length) * 8n;
		for (let i = 0; i < 8; i++) padded[padded.length - 8 - i] = Number((bits >> BigInt(i * 8)) & 0xffn);
		j0.set(ghash(h, new Uint8Array(), padded));
	}
	const counter = j0.slice();
	const ciphertext = new Uint8Array(plaintext.length);
	for (let offset = 0; offset < plaintext.length; offset += 16) {
		inc32(counter);
		const ks = encryptBlock(counter);
		const chunk = plaintext.subarray(offset, Math.min(offset + 16, plaintext.length));
		const out = new Uint8Array(chunk.length);
		for (let i = 0; i < chunk.length; i++) out[i] = chunk[i]! ^ ks[i]!;
		ciphertext.set(out, offset);
	}
	const s = ghash(h, aad, ciphertext);
	const tag = encryptBlock(j0);
	xorInto(tag, s);
	return { ciphertext, tag };
}

/** GCM 解密（只用分组**加密**原语；tag 不匹配返回 null，便于 API 层给统一错误）。 */
export function gcmDecrypt(
	encryptBlock: BlockCipher,
	iv: Uint8Array,
	ciphertext: Uint8Array,
	tag: Uint8Array,
	aad: Uint8Array = new Uint8Array()
): Uint8Array | null {
	const h = encryptBlock(new Uint8Array(16));
	const j0 = new Uint8Array(16);
	if (iv.length === 12) {
		j0.set(iv);
		j0[15] = 1;
	} else {
		const padded = new Uint8Array(Math.ceil(iv.length / 16) * 16 + 16);
		padded.set(iv);
		const bits = BigInt(iv.length) * 8n;
		for (let i = 0; i < 8; i++) padded[padded.length - 8 - i] = Number((bits >> BigInt(i * 8)) & 0xffn);
		j0.set(ghash(h, new Uint8Array(), padded));
	}
	const s = ghash(h, aad, ciphertext);
	const expected = encryptBlock(j0);
	xorInto(expected, s);
	if (expected.length !== tag.length) return null;
	let diff = 0;
	for (let i = 0; i < expected.length; i++) diff |= expected[i]! ^ tag[i]!;
	if (diff !== 0) return null;
	const counter = j0.slice();
	const plaintext = new Uint8Array(ciphertext.length);
	for (let offset = 0; offset < ciphertext.length; offset += 16) {
		inc32(counter);
		const ks = encryptBlock(counter);
		const chunk = ciphertext.subarray(offset, Math.min(offset + 16, ciphertext.length));
		const out = new Uint8Array(chunk.length);
		for (let i = 0; i < chunk.length; i++) out[i] = chunk[i]! ^ ks[i]!;
		plaintext.set(out, offset);
	}
	return plaintext;
}

/* ── SM4-GCM 便捷封装 ─────────────────────────────────────────────────── */

export function sm4GcmEncrypt(
	key: Uint8Array,
	iv: Uint8Array,
	plaintext: Uint8Array,
	aad?: Uint8Array
): { ciphertext: Uint8Array; tag: Uint8Array } {
	return gcmEncrypt((block) => sm4EncryptBlock(key, block), iv, plaintext, aad);
}

export function sm4GcmDecrypt(
	key: Uint8Array,
	iv: Uint8Array,
	ciphertext: Uint8Array,
	tag: Uint8Array,
	aad?: Uint8Array
): Uint8Array | null {
	return gcmDecrypt((block) => sm4EncryptBlock(key, block), iv, ciphertext, tag, aad);
}
