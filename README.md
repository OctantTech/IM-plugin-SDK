# IM Plugin SDK

InteMatrix 插件开发者 SDK。提供插件 manifest 校验、工具/Provider/Runtime 定义、脚本协议与宿主 API 类型。

私有发布在 GitHub Packages（`npm.pkg.github.com`，仅组织成员可读）：

```bash
# ~/.npmrc
# @octanttech:registry=https://npm.pkg.github.com
# //npm.pkg.github.com/:_authToken=<GITHUB_TOKEN>
bun add @octanttech/plugin-runtime-sdk@^1.0.0
```

```ts
import { definePlugin, defineTool } from '@octanttech/plugin-runtime-sdk';
```

## 目录

- `src/manifest.ts` — 插件 manifest 与统一校验
- `src/dependencies.ts` — 依赖声明/解析
- `src/crypto.ts`, `src/sm4.ts` — 插件参数密文协议
- `examples/` — fast/pro 插件示例

## 开发

```bash
bun install
bun run check-types
bun run test
```
