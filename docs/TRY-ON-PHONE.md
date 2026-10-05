# 手机试用指南

在本机启动 OpenMimic 服务，让同一局域网内的手机访问采访页面。

## 1. 配置环境变量

在仓库根目录创建 `.env`（已在 `.gitignore` 中）：

```
LLM_BASE_URL=https://api.your-provider.com/v1
LLM_API_KEY=sk-xxx
LLM_MODEL=your-model
OPENMIMIC_ADMIN_TOKEN=随便写一个密码
```

- `LLM_*` 三个变量用于驱动对话式采访（v4 chat）和人格法庭。不配也能跑演示流程。
- `OPENMIMIC_ADMIN_TOKEN` 必须设置——设置后服务才会绑定 `0.0.0.0`，手机才能访问。

语音识别（可选）：ASR 复用 `LLM_BASE_URL` / `LLM_API_KEY`，模型默认 `whisper-1`，可通过 `ASR_MODEL` 覆盖。不配 ASR 时采访页自动回退为文字输入。

## 2. 构建前端并启动服务

```bash
npm run build:web
npx tsx server/src/main.ts
```

服务监听端口默认 `7860`（可通过 `PORT` 覆盖）。

## 3. 获取局域网 IP

```bash
hostname -I
```

取第一个地址，假设为 `192.168.1.100`。

## 4. 创建当事人

```bash
TOKEN=你的OPENMIMIC_ADMIN_TOKEN

curl -s http://127.0.0.1:7860/api/subjects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"displayName": "张三"}'
```

返回中有 `"id": "xxxxxxxx-..."`, 记为 `SUBJECT_ID`。

## 5. 创建邀请链接

### 知情人采访（朋友/同事/家人讲述当事人）

```bash
curl -s http://127.0.0.1:7860/api/subjects/$SUBJECT_ID/invites \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

返回中有 `"token": "..."` 和 `"shortCode": "..."`.

### 自述采访（当事人自己讲述自己）

自述模式在打开邀请链接后、开始聊天时由前端传 `mode: "self"` 给 `POST /api/invites/:token/chat`。邀请创建方式相同，无需特殊参数——当事人打开链接后页面会自动检测。

## 6. 手机打开

在手机浏览器访问：

```
http://192.168.1.100:7860/i/<token>
```

其中 `<token>` 是上一步返回的邀请 token（长 UUID）或 shortCode（6 位短码）。

页面会自动进入对话式采访（v4 chat）；如果服务端未加载 chat 引擎则回退到问卷模式。

## 7. 管理页面

在电脑浏览器打开 `http://127.0.0.1:7860/` 即为管理首页（InviterView），可以创建当事人、生成邀请二维码、查看采集进度。
