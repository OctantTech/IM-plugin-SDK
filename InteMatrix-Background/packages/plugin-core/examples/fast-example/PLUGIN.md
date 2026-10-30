# Hello Fast（Fast 插件示例）

## 场景
演示 Fast Agent 插件的最小形态：**只有文档 + 脚本**，不安装任何系统依赖。

## 工具
- `hello(name)`：`scripts/hello.py`，接收 `--name`，输出问候 JSON。

## 文档阅读来源
- 插件开发规范：仓库 `docs/plugin-redesign.md`
- plugin.json v2 校验：`packages/plugin-core/src/manifest.ts`

## 安装方法
Fast 插件**没有安装步骤**，安装到代码仓后由宿主用受限 runner 执行脚本（python/ts，默认无网络）。

## 参数
- `apiToken`（密文）：示例参数，浏览器 SM2 加密后提交，服务端 SM4-GCM 落库。

## 失败与降级
脚本超时/异常只让该工具不可用，不影响整轮对话。
