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

## 4. 给管理页面传入令牌

管理首页（`/`）需要 admin token 才能调用后端管理接口。最便捷的方式是
在 URL 中附带一次性 `?admin=` 参数——页面会自动存储到浏览器并从地址栏
中移除（不会留在历史记录里）：

```
http://192.168.1.100:7860/?admin=你的OPENMIMIC_ADMIN_TOKEN
```

打开一次即可，之后在同一浏览器中再次访问 `/` 不需要重复输入。
也可以在管理页面底部点击"管理令牌"手动输入或清除。

> **手机快速上手**：只需在手机浏览器打开上述链接一次，管理页面就能在
> 手机上正常使用（创建当事人、生成二维码、查看进度等）。

## 5. 创建当事人

可以直接在管理页面（步骤 4 打开的页面）输入称呼并点击"生成邀请链接"，
也可以用 curl：

```bash
TOKEN=你的OPENMIMIC_ADMIN_TOKEN

curl -s http://127.0.0.1:7860/api/subjects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"displayName": "张三"}'
```

返回中有 `"id": "xxxxxxxx-..."`, 记为 `SUBJECT_ID`。

## 6. 创建邀请链接

### 知情人采访（朋友/同事/家人讲述当事人）

```bash
curl -s http://127.0.0.1:7860/api/subjects/$SUBJECT_ID/invites \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

返回中有 `"token": "..."` 和 `"shortCode": "..."`.

### 自述采访（当事人自己讲述自己）

创建邀请时传 `mode: "self"`：

```bash
curl -s http://127.0.0.1:7860/api/subjects/$SUBJECT_ID/invites \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mode":"self"}'
```

当事人打开该链接后，对话式采访会自动使用自述模式（关系方向为"如何理解自己"，开场说"理解你自己"）。管理页面的"自我访谈"按钮也可直接生成自述邀请。

## 7. 手机打开

在手机浏览器访问：

```
http://192.168.1.100:7860/i/<token>
```

其中 `<token>` 是上一步返回的邀请 token（长 UUID）或 shortCode（6 位短码）。

页面会自动进入对话式采访（v4 chat）；如果服务端未加载 chat 引擎则回退到问卷模式。

## 8. 管理页面

在电脑浏览器打开 `http://127.0.0.1:7860/?admin=你的TOKEN` 即为管理首页
（InviterView），可以创建当事人、生成邀请二维码、查看采集进度。令牌
只需传一次（见步骤 4）。
