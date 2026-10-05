# Chat Log Import

The `collector-chatlog` plugin lets the subject's initiator import chat logs
from messaging apps. The system parses the export, identifies each sender,
and stores only the designated person's own words into the corpus box.

**Imported chat records are used for mimicking word choice, rhythm, and
length. They are NOT treated as factual evidence.**

## Supported formats

### 1. Text (WeChat PC copy / export tool output)

Two layouts are recognized:

**Layout A** (time then name — WeChat PC default):
```
2024-03-15 14:30:25 王大明
今天下午有时间吗？

2024-03-15 14:30:45 赵小红
有啊，什么事？
```

**Layout B** (name then time — some third-party tools):
```
王大明 2024-03-15 14:30:25
今天下午有时间吗？

赵小红 2024-03-15 14:30:45
有啊，什么事？
```

Date/time formats accepted:
- `2024-03-15 14:30:25` (YYYY-MM-DD HH:mm:ss)
- `2024/03/15 14:30` (YYYY/MM/DD HH:mm)
- `2024年3月15日 14:30` (Chinese date)
- `03/15/2024 14:30` (US date format)
- ISO 8601 (`2024-03-15T14:30:25Z`)

### 2. CSV

Columns are auto-detected by header name. Recognized column names:

| Purpose | Column names (case-insensitive) |
|---------|-------------------------------|
| Time    | time, date, datetime, timestamp, 时间, 日期, 发送时间 |
| Sender  | sender, name, from, user, 发送者, 发送人, 昵称, 用户 |
| Content | content, message, text, body, msg, 内容, 消息, 文本 |
| Type    | type, msgtype, message_type, 类型, 消息类型 |

Example:
```csv
时间,发送者,内容
2024-03-15 14:30,王大明,今天下午有时间吗
2024-03-15 14:31,赵小红,有啊
```

Quoted fields with embedded commas and newlines are handled correctly.

Column names can also be overridden via the `csvColumns` option when the
auto-detection does not work.

### 3. JSON

A JSON array of message objects:
```json
[
  { "time": "2024-03-15 14:30", "sender": "王大明", "content": "今天下午有时间吗" },
  { "time": "2024-03-15 14:31", "sender": "赵小红", "content": "有啊" }
]
```

Recognized field names: `time`/`timestamp`/`date`/`时间`,
`sender`/`name`/`from`/`发送者`/`昵称`,
`content`/`message`/`text`/`msg`/`内容`/`消息`.

## Denoising

The following message types are automatically identified and excluded
from the corpus:

- System messages: recalled, group join/leave, name changes, "pat"
- Media placeholders: `[图片]`, `[语音]`, `[视频]`, `[文件]`, `[动画表情]`
- Red packets, call records, forwarded messages
- Link cards, location/contact shares
- Pure URLs, bracket placeholders

Consecutive messages from the same sender are tracked as "bursts" (rhythm
metadata), but each message remains a separate corpus item — merging would
lose the timing information that characterizes the person's speech rhythm.

## Privacy

- The raw file is parsed entirely in memory. Nothing is written to disk.
- PII (phone numbers, email addresses, ID card numbers, bank card numbers,
  credential leaks) is replaced with placeholders before storage.
- Suspected prompt injection text is flagged (not rejected).
- Text matching prior AI-generated output (reflux) is excluded.
- Only the designated person's own words enter the corpus. Other
  participants' messages are discarded by default.
- Imported corpus items are marked `source: 'imported'`.

## API

All routes require admin authentication (when configured).

### Preview

```
POST /api/subjects/:id/chatlog/preview
Content-Type: application/json

{
  "content": "<raw chat export text>",
  "format": "text" | "csv" | "json",      // optional, auto-detected
  "csvColumns": { ... },                   // optional column overrides
  "maxSizeBytes": 5242880                  // optional, default 5MB
}
```

Returns: format, sender list with counts, denoise stats, failed lines.
Does not write to the database.

### Import

```
POST /api/subjects/:id/chatlog/import
Content-Type: application/json

{
  "content": "<raw chat export text>",
  "selfNames": ["王大明"],                  // required, at least one
  "format": "text" | "csv" | "json",      // optional
  "maxLength": 120,                        // optional, max text length
  "keepLowContent": true,                  // optional, keep "嗯"/"哦" etc
  "maxItems": 500                          // optional, max corpus items
}
```

Returns: import ID, item count, stats, style profile preview.

### List imports

```
GET /api/subjects/:id/chatlog/imports
```

Returns metadata about past imports (time, format, count, sender names).
Does not include raw text.

### Undo import

```
DELETE /api/subjects/:id/chatlog/imports/:importId
```

Deletes the import record and returns the corpus item IDs that should be
removed. **Note:** Actual corpus item deletion requires `Store.deleteCorpusItem()`,
which is a kernel capability not yet implemented.

## Known unsupported

- **Encrypted database exports** (e.g., WeChat's EnMicroMsg.db): requires
  decryption keys that this tool intentionally does not handle.
- **Image-based chat screenshots**: OCR is not implemented.
- **WeChat enterprise "combined forward" XML/JSON**: the old platform's
  parser handled this specific format; this plugin does not carry it over.
  The generic text/CSV/JSON parsers cover the common export paths.
- **Real-time sync**: this is a batch import tool, not a live connector.
- **Multi-format mixed files**: each import handles one format at a time.

## Configuration

In `openmimic.yml`:
```yaml
plugins:
  - use: "./plugins/collector-chatlog"
    config:
      maxSizeBytes: 5242880   # 5 MB
      maxItems: 500
      maxLength: 120
```
