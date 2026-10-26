# 桌面工作台 · DeskGlass

把常用文件夹、待办和 AI 工具放到 Mac 桌面上，随时可见，也随手可用。

DeskGlass 用 SwiftUI 和 AppKit 构建，深色玻璃卡片透出你的真实壁纸。它不替换桌面，不需要注册账户。除了工作入口，还可以在桌面摆一辆可换色的跑车，或养一只会捡球、摇尾巴的电子小狗。

[English](README.en.md) · [下载安装](https://github.com/zhongqingqiang01-ship-it/DeskGlass/releases/latest) · [使用指南](docs/USAGE.md) · [反馈问题](https://github.com/zhongqingqiang01-ship-it/DeskGlass/issues)

![DeskGlass 功能预览：演示数据，非个人工作内容](docs/images/overview.png)

## 可以做什么

- **常用文件夹**：固定文件夹、浏览子目录、打开文件、在 Finder 中定位。支持拖动排序、重命名、新建文件夹、移动和移到废纸篓；同名项目不会被覆盖。
- **待办**：新增本地待办、设置截止日期、完成或恢复。可选连接 Mac 提醒事项、钉钉待办，只读展示。
- **AI 入口**：预置 ChatGPT、Claude、Gemini；可添加任意网页或本机应用，直接使用应用原有图标。
- **桌面布局**：位置默认锁定，可调整宽高、玻璃浓度，自动适应主显示器；支持多桌面显示。
- **每日寄语**：按北京时间每天切换，也可以手动换一句。
- **离线 3D 展品**：跑车支持换色、旋转和车轮互动；电子小狗会追鼠标、捡球、吃饭、表演和睡觉。展示资源随应用打包。

## 下载安装

当前提供 **Apple Silicon（M1/M2/M3/M4 等）、macOS 14 或更新系统**的安装包。界面为简体中文。Intel Mac 可尝试从源码构建，尚未完成实机验收。

1. 打开 [Releases](https://github.com/zhongqingqiang01-ship-it/DeskGlass/releases/latest)，下载 `DeskGlass-0.1.0-macos-arm64.zip`。
2. 解压，将「桌面工作台.app」拖到「应用程序」。
3. 打开应用，通过菜单栏的工作台图标进入设置，添加自己的文件夹和工具。

当前发布包采用本地 ad-hoc 签名，**尚未经过 Apple Developer ID 签名和公证**。首次启动如果被系统拦截，可在确认下载来源后，前往「系统设置 → 隐私与安全性」查看对应应用的「仍要打开」。若系统仍不允许打开，可以采用下面的源码构建方式。不要关闭整个系统的安全保护。

工作台常驻菜单栏，不显示 Dock 图标。`Control + Option + 空格` 可以把它呼到其他窗口上方，再按一次回到桌面层；`Command + ,` 打开设置。

## 从源码运行

需要 macOS 14+ 和 Xcode Command Line Tools。首次安装开发工具：

```sh
xcode-select --install
```

然后：

```sh
git clone https://github.com/zhongqingqiang01-ship-it/DeskGlass.git
cd DeskGlass
./build.sh
open "dist/桌面工作台.app"
```

日常构建只使用 Swift 编译器和随仓库附带的离线资源，**不需要安装 Node.js 或下载模型**。也可以双击项目中的「启动工作台.command」。

## 数据和权限

配置、本地待办和文件排列保存在：

```text
~/Library/Application Support/DeskGlass/workspace.json
```

位置、外观和电子小狗状态保存在 macOS 用户偏好设置中。在设置窗口底部可以打开数据目录，退出应用后复制该目录即可备份本地工作数据。

- 没有项目自建的后台服务、统计上报或账户系统。
- 文件夹由你主动选择；「移除入口」只移除工作台卡片，不删除磁盘文件。
- 删除文件需要确认，只移入系统废纸篓。移动和重命名不覆盖同名文件。
- 提醒事项只有点击连接后才申请权限。钉钉使用你另行安装并登录的 `dws`，不随安装包提供；具体命令及当前限制见[使用指南](docs/USAGE.md#外部待办)。
- 外部账户数据不持久缓存；打开网页或使用第三方账户时，适用对应服务自己的规则。

## 开发与验证

```sh
./test.sh             # 隔离临时目录中的核心行为测试
./build.sh            # 构建并进行本地签名
./test-stage.sh       # 实际打开 WebKit 窗口，验证离线 3D 与小狗互动
./scripts/package.sh # 打包公开发行的 ZIP 和 SHA-256 校验文件
```

需要修改 3D 渲染器时，使用 Node.js 20+：

```sh
npm ci
npm run build:stage
npm test
./build.sh
```

核心 Swift 部分没有第三方依赖。渲染器依赖在 `package-lock.json` 中锁定；不使用远程脚本或 CDN。更多结构和接入方式见[开发说明](docs/DEVELOPMENT.md)。

## 开源范围与素材

应用源码、程序化电子小狗和本项目编写的交互代码采用 [MIT License](LICENSE)。three.js 使用其自身的 MIT 许可；Ferrari 458 Italia 模型由 vicent091036 创作，采用 CC BY 4.0，保留署名、来源及修改说明。**项目的 MIT 许可不会改变第三方素材的许可。**详情见[第三方说明](THIRD_PARTY_NOTICES.md)。

开源版**不附带高达模型、贴图、原始下载文件或含该模型的宣传素材**。仅保留本项目编写的可选动画适配代码；使用者如持有适用许可，可在本地导入兼容模型，不应将受限资源重新上传到仓库、Release 或公开构建产物。

## 目前的边界

- 右侧文件夹、待办和工具区整体移动，尚不支持每张卡独立拖动。
- 不默认开机启动，不修改壁纸，不自动连接账户。
- 不在应用中修改或完成第三方待办。
- 未完成 Apple 公证、Intel 实机测试，以及不同组织钉钉账户的全面兼容测试。

欢迎通过 [Issue](https://github.com/zhongqingqiang01-ship-it/DeskGlass/issues) 提交问题和建议，或按[贡献指南](CONTRIBUTING.md)提交改进。
