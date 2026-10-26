# 开发说明

## 结构

```text
Sources/          SwiftUI、AppKit、持久化、文件操作和外部待办
Resources/Stage/  直接可用的离线 WebKit 页面与已构建资源
Assets/           允许再分发的原始模型输入
Tools/stage/      项目编写的建模和动画代码
Tools/            资源构建、本地模型导入和 3D 验证工具
Tests/            使用临时目录的行为验证
scripts/          公开发行打包
```

`./build.sh` 默认构建当前机器架构。也可以用 `ARCH=arm64 ./build.sh` 或 `ARCH=x86_64 ./build.sh` 交叉构建；实际运行和行为测试必须在支持目标架构的机器上完成。最低系统版本是 macOS 14。

## 重建离线资源

使用 Node.js 20+，执行 `npm ci`，再运行 `npm run build:stage`。脚本从 `Assets/ferrari.glb` 解码几何并生成 `models/ferrari.js`，随后将 three.js 和本项目渲染代码打包到 `scene.bundle.js`。所有依赖都有锁定版本。

常规 Swift 构建直接使用已生成的文件，不安装 npm 依赖、不下载模型。

## 可选本地模型

`Tools/stage/gundam.js` 是本项目编写的骨骼绑定、动作和灯光适配器，不包含原模型网格或贴图。它只适配特定几何尺寸、朝向和部件布局，不是任意 GLB 的通用动画引擎。

如果你自行持有适用许可的兼容 GLB，可在自己的本地副本中执行：

```sh
node Tools/import-local-model.mjs "/path/to/your-compatible-model.glb"
./build.sh
```

GLB 必须包含内嵌几何和贴图，不能引用外部 URL 或侧文件；Draco 压缩几何需先在本地解码。导入器只读取 GLB 数据，不接受可执行 JS。它生成被 Git 忽略的 `Resources/Stage/models/gundam.js` 并更新本地资源清单，应用会根据资源是否存在显示对应入口。

导入不改变模型许可。请勿把这些受限数据、含该数据的应用包或演示媒体推送到公开仓库。`scripts/package.sh` 和资源测试会拒绝带有额外模型的公开打包。恢复公开配置时，移走自己的本地数据文件，并将 `Resources/Stage/assets.js` 恢复为仓库版本。

## 验证

- `./test.sh`：持久化、文件操作、不覆盖同名文件、异常数据保护、日期、拖动排序、外部任务解析等核心行为。
- `npm test`：公开资源范围、离线页面策略、本地导入错误处理。
- `./test-stage.sh`：真实 WebKit 渲染、车漆、视角，以及小狗捡球、进食、表演和睡眠。需要图形桌面，会短暂出现验证窗口。
- `./scripts/package.sh`：检查没有混入私有模型，再构建、验证签名并生成 ZIP 和 SHA-256 文件。

第一次在新目录构建时，会建立自己的 `.build/ModuleCache`；不要复制其他绝对路径下的 Swift 模块缓存。

## 权限与发行

开发版使用 ad-hoc 签名，不包含开发者证书、令牌或公证凭据。将来如果引入 Developer ID 发行，请通过 GitHub Secrets 或本机钥匙串注入凭据，不把它们提交到 Git。

每次升级外部 `dws` 接口，应先核对其实际 Help / JSON 格式，再修改解析；不把登录失败或未完成的分页当作成功。
