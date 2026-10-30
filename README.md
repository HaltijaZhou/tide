# oh-my-mark

轻量级单文件 Markdown 编辑器。采用 Typora 式的即编即显（Instant Rendering）模式，界面极简，完全离线可用，适合日常记笔记、写文档。

## 核心特性

- **单文件模型**：一次只编辑一个 Markdown 文件，打开即用，没有工作区、标签页等多余概念
- **打开与保存**：使用 Ctrl+O 或拖拽打开文件；Ctrl+S 保存，未命名文档会提示选择保存位置
- **防抖自动保存 + 原子写入**：停止输入后自动保存，先写临时文件再重命名，避免写入中断导致文件损坏
- **外部变更监视**：文件被其他程序修改时静默重载（无未保存修改的情况下）；有未保存修改则暂停自动保存并提示冲突，由你决定保留哪个版本
- **脏状态退出保护**：有未保存修改时关闭窗口会先询问，防止误丢内容
- **暗色模式跟随系统**：自动适配系统深浅色主题

## 技术栈

- [Tauri 2](https://tauri.app/)（桌面框架）
- [Vite](https://vite.dev/) + TypeScript
- [Vditor](https://github.com/Vanessa219/vditor)（IR 即时渲染模式）
- Rust（[notify](https://github.com/notify-rs/notify) 文件监视）

## 开发

```bash
npm install        # 安装依赖
npm run dev        # 浏览器中开发（无 Tauri 外壳）
npm run tauri dev  # 桌面窗口中开发
```

测试与构建：

```bash
npm test                            # 前端单元测试（vitest）
cd src-tauri && cargo test          # Rust 单元测试
npm run tauri build                 # 发布构建
```

## 依赖协议

| 依赖 | 协议 |
| --- | --- |
| Tauri | MIT / Apache-2.0 |
| Vditor | MIT |
| notify | MIT |
| tauri-plugin-dialog | MIT / Apache-2.0 |
| Vite | MIT |
| Vitest | MIT |

## License

[MIT](LICENSE)
