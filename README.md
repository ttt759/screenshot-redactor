# 截图脱敏助手

把教程截图中的邮箱、订单号和二维码遮住，逐张检查后按顺序导出。图片只在浏览器里处理，无需注册或上传。

**[打开在线演示](https://ttt759.github.io/screenshot-redactor/)** · [查看 v0.1.0](https://github.com/ttt759/screenshot-redactor/releases/tag/v0.1.0)

![截图脱敏助手操作演示，依次遮挡、预览、检查并导出 ZIP](./demo.gif)

## 使用方式

1. 拖入多张静态 PNG 或 JPG，也可以点「添加」，或用 `Ctrl/⌘ + V` 粘贴截图。首次成功导入时，你的截图会替换页面自带的虚构示例。
2. 用「画遮挡框」拖出黑块。选中黑块可移动、拖动四角调整大小、删除或撤销。需要定位小字时可以放大，再用手形工具平移。
3. 切到「成品预览」，检查覆盖范围后标记为「已检查」。编辑过的截图会重新变成待检查。导出时会列出尚未检查的文件。
4. 导出当前 PNG，或将列表里的截图打成 ZIP。ZIP 内从 `01-redacted.png` 开始按列表顺序命名。

导出会按原图显示尺寸重绘 PNG，把不透明的纯黑像素直接写进成品。源文件保留在原处，编辑记录在当前页面会话中保存，刷新页面会清除当前批次。

## 示例素材

页面内置三张虚构截图，可以直接在网页里试用，也可以下载后重新导入。

| [账号信息](docs/samples/account.png) | [付款页面](docs/samples/checkout.jpg) | [付款记录](docs/samples/receipt.png) |
| --- | --- | --- |
| ![虚构账号页](docs/samples/account.png) | ![虚构付款页](docs/samples/checkout.jpg) | ![虚构付款记录](docs/samples/receipt.png) |

## 本地运行

下载仓库后，在项目目录运行 `npm start`，然后打开 [本地页面](http://127.0.0.1:5173/)。运行网页无需安装依赖。`docs/` 是完整的静态站点，可直接作为 GitHub Pages 发布目录。

## 验证

```sh
npm ci
npm test
npx playwright install chromium
npm run test:e2e
```

浏览器验收会一次拖入 10 张混合尺寸的 PNG/JPG，在其中三张遮住邮箱、订单号和二维码，逐张预览确认后下载 ZIP。测试会解压并检查顺序、尺寸、黑块像素，以及导出图片与成品预览逐像素一致。

ZIP 由本地打包的 [fflate](https://github.com/101arrowz/fflate) 生成。第三方许可见 [fflate.LICENSE.txt](docs/vendor/fflate.LICENSE.txt)。
