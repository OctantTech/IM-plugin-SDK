# Maven 工程师（Pro 插件示例）

## 场景

Pro 专家线需要真实工具链时使用：本示例演示 **install 方法 + 工具链声明 + build/test/verify 门禁脚本**。

## 工具链

- `install/install.sh`：安装/校验 JDK 与 Maven（**幂等**，离线环境可从自带 `toolchain/` 解包）。
- `install/verify.sh`：`java -version` / `mvn -v` 健康检查，安装成功判据。

## 文档阅读来源

- 插件开发规范：`docs/plugin-redesign.md`
- Maven 官方文档：https://maven.apache.org/

## 安装方法

用户点击安装时异步执行 `install.sh`（离线包库，不访问公网）；失败会返还安装次数。

## 参数

- `mavenSettings`（密文）：settings.xml 内容，SM4-GCM 加密落库。
- `mavenMirror`（明文）：镜像地址，默认阿里云。

## 依赖与计费

示例无依赖；实际插件可在 `dependencies` 声明其他插件（如 git 插件），下单时依赖统一计费。

## 失败与降级

工具链安装失败 → 该代码仓阶段 fail-closed，提示用户重试；不静默降级。
