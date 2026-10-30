/**
 * 生成插件密文参数所需密钥（部署时执行一次，结果放服务端 env / KMS）：
 *   bun run keys
 *
 * 输出：
 *   PLUGIN_SM2_KEY_ID=...
 *   PLUGIN_SM2_PRIVATE_KEY=<hex>      （只放服务端，绝不进前端）
 *   PLUGIN_SM2_PUBLIC_KEY=<hex>       （前端拉取，可公开）
 *   PLUGIN_PARAM_KEK=<64 hex chars>   （32 字节，只放服务端）
 *   PLUGIN_PARAM_KEK_ID=k1
 */
import { randomBytes } from 'node:crypto';
import { generateSm2KeyPair } from '../src/crypto';

const pair = generateSm2KeyPair();
const kek = randomBytes(32).toString('hex');
const keyId = `sm2-${new Date().toISOString().slice(0, 10)}`;

console.log(`# 插件参数密钥（请只写入服务端 env / KMS）`);
console.log(`PLUGIN_SM2_KEY_ID=${keyId}`);
console.log(`PLUGIN_SM2_PRIVATE_KEY=${pair.privateKey}`);
console.log(`PLUGIN_SM2_PUBLIC_KEY=${pair.publicKey}`);
console.log(`PLUGIN_PARAM_KEK=${kek}`);
console.log(`PLUGIN_PARAM_KEK_ID=k1`);
