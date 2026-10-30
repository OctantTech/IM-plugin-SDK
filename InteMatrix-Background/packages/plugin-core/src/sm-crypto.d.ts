declare module 'sm-crypto' {
	export const sm2: {
		generateKeyPairHex(): { privateKey: string; publicKey: string };
		getPublicKeyFromPrivateKey(privateKey: string): string;
		doEncrypt(msg: string, publicKey: string, cipherMode?: number): string;
		doDecrypt(encryptData: string, privateKey: string, cipherMode?: number): string;
		doSignature(msg: string, privateKey: string, options?: { der?: boolean }): string;
		doVerifySignature(
			msg: string,
			signHex: string,
			publicKey: string,
			options?: { der?: boolean }
		): boolean;
	};
	export const sm3: (input: string | number[]) => string;
	export const sm4: unknown;
}
