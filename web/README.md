# @openmimic/web

OpenMimic 的手机访谈间(H5)与发起人页。Vue 3 + Vite + TypeScript,样式全部手写。

## 开发(两个终端)

```console
# 终端 1:采集 API(默认 http://127.0.0.1:7860)
npm run dev:server
# 终端 2:Vite 开发服务器(默认 http://127.0.0.1:5173)
npm run dev:web
```

Vite 把 `/api` 代理到 `7860`(见 `vite.config.ts`),浏览器只面对一个来源。

## 构建与静态托管

```console
npm run build -w @openmimic/web
npm run dev:server
```

`web/dist` 存在时,server 把所有非 `/api/*` 请求交给静态文件;找不到文件且路径没有扩展名时回退到 `index.html`,因此 `/i/<token>` 刷新可用。

## 两个路由

- `/i/:token` —— 访谈间(一屏一题、语音输入、sessionStorage 暂存草稿)。
- `/` —— 发起人页(生成邀请链接、每 10 秒轮询进度)。
- 测试:`web/src/{answers,interview,api}.ts` 是不依赖 DOM 的纯逻辑模块,由根目录
  vitest 直接测试;`.vue` 文件不做类型检查(需要 vue-tsc,不在依赖白名单内)。
