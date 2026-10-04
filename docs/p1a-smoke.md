# P1a 冒烟验证:无 key 起服,curl 五端点

> 2026-10-05 · 命令均在 `/home/liuce/code/openmimic` 执行,全部本机 / 零真实上游。

## 0. 构建与全量测试

```console
$ npm run typecheck
(exits 0)

$ npm test
 Test Files  23 passed (23)
      Tests  189 passed (189)
```

新增/重写:court.test.ts 19 + persona.test.ts 11 + episodes.test.ts 9 + fixture-validation.test.ts 9 = 48 条,全部离线。

## 1. 无 key 起服

```console
$ npx tsx server/src/main.ts &
# 等 "listening on http://0.0.0.0:7860"
```

无 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 时服务器正常启动,林默演示数据自动 seed。

## 2. curl 五端点

### /v1/models

```console
$ curl -s http://localhost:7860/v1/models | jq '.data[].id'
"persona/limo"
```

### POST /api/subjects/limo/court (无 key 降级到预生成)

```console
$ curl -s -X POST http://localhost:7860/api/subjects/limo/court | jq '.session.report'
{
  "totalClaims": 7,
  "surviving": 3,
  "qualified": 2,
  "contested": 2,
  ...
  "episodeCount": 18,
  "divergences": 5
}
```

### GET /api/subjects/limo/divergences

```console
$ curl -s http://localhost:7860/api/subjects/limo/divergences | jq '.divergences | length'
5
$ curl -s http://localhost:7860/api/subjects/limo/divergences | jq '.divergences[0].type'
"factual"
```

### GET /api/subjects/limo/episodes

```console
$ curl -s http://localhost:7860/api/subjects/limo/episodes | jq '.episodes | length'
18
$ curl -s http://localhost:7860/api/subjects/limo/episodes | jq '.episodes[0].text' | head -c 60
"他给团队买下午茶、给实习生报销打车费,从来不卡"
```

synthesis_only episodes are withheld from this endpoint.

### GET /api/subjects/limo/corpus

```console
$ curl -s http://localhost:7860/api/subjects/limo/corpus | jq '.items | length'
10
$ curl -s http://localhost:7860/api/subjects/limo/corpus | jq '.items[0].text'
"我好像除了上班不会干别的了。"
```

## 3. 结论

五个端点均正常返回,演示数据含 7 claims(5 surviving + 2 contested)、18 episodes、5 divergences、10 corpus items。无 API key 时服务器降级到预生成法庭数据,不报错。
