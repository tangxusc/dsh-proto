# 特设POC\-本体平台接

# **特设POC\-本体平台接口文档**



## **1\. 文档引用**

- [失效分析 V1\.2 本体平台业务接口设计](https://bba12hub36.feishu.cn/wiki/AZ9qww2mDin7gOklZPJcxDS3nTg) 本体平台业务接口设计

- http://120\.79\.209\.254/generate/input?step=basic\&plan=1787020208313 特设原型

## **2\. 本体平台接口**



|接口|用途|接口说明|是否返回完整结果|
|---|---|---|---|
|`POST {ontologyBaseUrl}/open-api/ai/v1/special-equipment/upload-files`|上传文件|将本地试验依据文档或功能内容图片上传至 AI 平台，取得后续解析、预览或附件引用使用的文件标识|是，返回文件信息|
|`GET {ontologyBaseUrl}/open-api/ai/v1/special-equipment/knowledge-files`|列出知识库试验依据文件|按文件名称分页查询知识库中已解析的试验依据文件，供方案编制人员选择和预览|是，返回文件分页列表|
|`GET {ontologyBaseUrl}/open-api/ai/v1/special-equipment/file/preview/{fileId}`|预览文件|根据来源版本 UUID 读取试验依据文档或功能内容图片，支持通过请求头或 URL 查询参数传递访问令牌|是，返回文件二进制|
|`POST {ontologyBaseUrl}/open-api/ai/v1/special-equipment/parse-files`|解析文件<br>|对已上传的试验依据文档执行内容解析，为功能项试验信息生成准备可检索、可引用的文档内容；不解析图片|否，仅返回任务回执|
|`POST {ontologyBaseUrl}/open-api/ai/v1/{planId}/functional-item-generations`|生成功能项试验信息<br>|基于方案基本信息、已解析试验依据及平台知识，生成功能项总体要求、功能点和可追溯依据|否，仅返回任务回执|
|`POST {ontologyBaseUrl}/open-api/poc/test-plan/generate`|生成试验方案<br>|根据已确认的功能项试验信息和试验依据生成方案章节，供后续编辑、审查和导出|否，仅返回任务回执|
|`GET {ontologyBaseUrl}/open-api/ai/v1/tasks/{aiTaskId}/events`|订阅任务进度|按 AI 任务标识持续推送解析和生成任务的处理阶段、进度、终态及相应结果|按任务类型返回进度或结果|





## **3\. 接口详情**



### **3\.1 上传文件\-请求**



#### **接口说明**



用于将方案编制人员选择的本地试验依据文档或功能内容图片上传至 AI 平台。接口返回文件 UUID 和元数据：试验依据文档的 `fileId` 用于预览、解析及后续生成任务引用；图片的 `fileId` 仅用于预览和功能内容附件引用。



图片不属于试验依据，不参与内容解析或功能项生成，不得写入 `testBasisFiles`，也不会出现在知识库试验依据文件列表中。



```HTTP
POST {ontologyBaseUrl}/open-api/ai/v1/special-equipment/upload-files HTTP/1.1
Authorization: Bearer TOKEN
tenant-id: 1
Content-Type: multipart/form-data; boundary=----WebKitFormBoundaryabc123
Accept: application/json

------WebKitFormBoundaryabc123
Content-Disposition: form-data; name="file"; filename="通电检查接线示意图.png"
Content-Type: image/png

<PNG 图片的二进制数据>
------WebKitFormBoundaryabc123--
```



|字段路径|类型|必填|说明|
|---|---|---|---|
|`domainCode`|string|是|路径参数，同时作为 datasource 名称和 MinIO bucket，示例为 `special-equipment`|
|`file`|binary|是|待上传的试验依据文档或功能内容图片，不能为空|



文件限制：



|限制项|规则|
|---|---|
|支持格式|PDF、Word（`.doc`、`.docx`）、Excel（`.xls`、`.xlsx`）、图片（`.jpg`、`.jpeg`、`.png`、`.gif`、`.webp`）|
|单文件大小|取 `spring.servlet.multipart.max-file-size` 配置，当前配置为 `50MB`|
|文件数量|每次请求只接收一个名为 `file` 的 multipart 字段|
|文件名称|用于展示、来源版本归组和开放上传重复判断；精确区分大小写，但不作为拒绝上传的依据|



格式与用途：



|文件类别|格式或媒体类型|允许用途|禁止用途|
|---|---|---|---|
|试验依据文档|`.pdf`、`.doc`、`.docx`、`.xls`、`.xlsx`|预览、解析、作为试验依据、参与功能项生成|—|
|功能内容图片|`.jpg`/`.jpeg`（`image/jpeg`）、`.png`（`image/png`）、`.gif`（`image/gif`）、`.webp`（`image/webp`）|预览、作为功能项试验信息或功能点字段的手工上传附件|解析、作为试验依据、参与功能项生成、进入知识库试验依据列表|



#### **异常响应**



错误响应沿用平台 `CommonResult` 和全局异常处理，校验或登记失败时不保留本次上传对象。下表状态含义为业务场景说明，不是接口强制的 HTTP 状态映射。



|场景|业务错误|说明|
|---|---|---|
|文件为空|文件为空|未提供 `file` 或文件内容为空|
|文件类型不支持|类型不支持|扩展名不在支持格式白名单内，包括 SVG 及其他未支持的图片格式|
|文件类型不一致|类型不一致|扩展名、`Content-Type` 与实际文件内容不匹配|
|单文件超过限制|文件过大|文件大小超过当前 `50MB` 配置|
|文件内容和名称均重复|上传成功并返回已有文件标识|同租户、领域、安全域、区分大小写的原始文件名和 SHA\-256 均一致时复用已有来源版本，不创建新版本|
|文件内容相同、名称不同|上传成功并返回新文件标识|文件名不同或仅大小写不同时创建新来源版本，不复用原 `fileId`|
|领域代码不合法|上下文不合法|`domainCode` 不符合 MinIO bucket 命名规则，例如包含下划线或大写字母|
|datasource 配置冲突|数据源配置无效|当前租户下同名 datasource 不是 YAML 配置对应的可用 MinIO 数据源|
|MinIO bucket 创建失败|文件存储失败|MinIO 鉴权、网络或 bucket 创建失败，不登记文件元数据|



### **3\.2 上传文件\-响应**



上传成功：



```JSON
{
  "code": 0,
  "msg": "",
  "data": {
    "fileId": "18a4c6e2-5b73-4d90-a1f8-2c6e9b7d3045",
    "fileName": "通电检查接线示意图.png",
    "fileType": "image/png",
    "fileSize": 245760,
    "primary": false
  }
}
```





|字段路径|类型|必填|说明|
|---|---|---|---|
|`code`|integer|是|通用响应码，`0` 表示上传成功|
|`msg`|string|是|提示信息，成功时为空字符串|
|`data`|object|是|上传结果|
|`data.fileId`|string|是|来源版本 UUID，即 `knowledge_source_version.version_id`；文档可用于预览、解析和试验依据引用，图片仅用于预览和功能内容附件引用|
|`data.fileName`|string|是|本次文件名称；复用只发生在名称精确一致时，因此与 `fileId` 对应版本名称保持一致|
|`data.fileType`|string|是|文件媒体类型；图片返回 `image/jpeg`、`image/png`、`image/gif` 或 `image/webp`|
|`data.fileSize`|integer|是|文件大小，单位为字节|
|`data.primary`|boolean|是|上传阶段所有文件固定返回 `false`；是否作为主要依据由后续业务流程决定|





### **3\.3 列出知识库试验依据文件\-请求**



#### **接口说明**



用于在原型的“从知识库选择试验依据文件”弹窗中，按文件名称分页查询可引用的知识库文件。服务端固定只返回解析完成、状态为 `READY` 的 `.pdf`、`.doc`、`.docx`、`.xls`、`.xlsx` 文件；图片只作为功能内容附件，不属于试验依据，因此即使已通过 `upload-files` 上传，也不在本接口返回。文件格式和解析状态不由客户端传入，避免客户端选中尚不可用于生成任务的文件。



```HTTP
GET {ontologyBaseUrl}/open-api/ai/v1/special-equipment/knowledge-files?keyword=通电检查&pageNo=1&pageSize=20 HTTP/1.1
Authorization: Bearer TOKEN
tenant-id: 1
Accept: application/json
```



|字段路径|类型|必填|说明|
|---|---|---|---|
|`domainCode`|string|是|路径参数，知识文件归属领域及 datasource 名称，示例为 `special-equipment`|
|`keyword`|string|否|文件名称关键字，按名称模糊匹配；不传或传空字符串时查询全部符合条件的文件|
|`pageNo`|integer|否|页码，从 `1` 开始，默认值为 `1`|
|`pageSize`|integer|否|每页记录数，默认值为 `20`，取值范围为 `1` 到 `200`|



### **3\.4 列出知识库试验依据文件\-响应**



```JSON
{
  "code": 0,
  "msg": "查询成功",
  "data": {
    "list": [
      {
        "fileId": "7c6e9d2f-3a41-4b8c-9e52-1f6a7d8c0b35",
        "fileName": "xxxx航电任务系统设备通电检查技术要求.docx",
        "fileSize": 2726298,
        "fileType": ".docx",
        "previewUrl": "/open-api/ai/v1/special-equipment/file/preview/7c6e9d2f-3a41-4b8c-9e52-1f6a7d8c0b35"
      }
    ],
    "total": 4
  }
}
```



|字段路径|类型|必填|说明|
|---|---|---|---|
|`code`|integer|是|通用响应码，`0` 表示查询成功|
|`msg`|string|是|查询结果说明|
|`data`|object|是|知识库试验依据文件分页结果|
|`data.list`|array|是|当前页文件列表；没有符合条件的文件时返回空数组 `[]`|
|`data.list[]`|object|—|单个已解析试验依据文件|
|`data.list[].fileId`|string|是|当前生效 READY 来源版本 UUID，即 `knowledge_source_version.version_id`；用于文件预览及后续生成任务引用|
|`data.list[].fileName`|string|是|文件名称|
|`data.list[].fileSize`|integer|是|文件大小，单位为字节；客户端可转换为 KB、MB 等可读单位展示|
|`data.list[].fileType`|string|是|带点的小写文件扩展名；取值为 `.pdf`、`.doc`、`.docx`、`.xls` 或 `.xlsx`|
|`data.list[].previewUrl`|string|是|文件预览地址；调用时通过 `Authorization` 请求头或 `token` 查询参数传递访问令牌|
|`data.total`|integer|是|符合查询条件的文件总数；没有符合条件的文件时返回 `0`|



#### **异常响应**



错误响应沿用平台通用错误结构；无符合条件的文件不属于异常，返回 HTTP `200`、空数组 `data.list` 和 `data.total=0`。



|场景|HTTP 状态码|说明|
|---|---|---|
|分页参数不合法|`400`|`pageNo` 小于 `1`，或 `pageSize` 超出平台允许范围|
|鉴权失败|`401`|未提供访问令牌，或访问令牌无效、已过期|
|知识库文件查询失败|`500`|服务端查询或数据转换异常，不返回不完整的分页结果|





### **3\.5 预览文件\-请求**



#### **接口说明**



用于按来源版本 UUID 读取已上传的试验依据文档或功能内容图片。服务端按当前租户、路径指定的领域和数据源校验可见性后，从 MinIO 流式读取对象。原型中的文件列表和功能内容附件通过该接口提供只读预览，帮助方案编制人员核对原始依据或图片内容。



访问令牌支持以下两种传递方式，至少传入一种：



1. 请求头：`Authorization: Bearer TOKEN`，推荐用于可自定义请求头的客户端。

2. URL 查询参数：`token=TOKEN`，用于浏览器地址、内嵌预览等无法设置请求头的场景。

两种方式同时传入时，以 `Authorization` 请求头中的令牌为准。URL token 可能被浏览器历史、代理或访问日志记录，仅在无法设置请求头时使用。



请求头传递 token：



```HTTP
GET {ontologyBaseUrl}/open-api/ai/v1/special-equipment/file/preview/7c6e9d2f-3a41-4b8c-9e52-1f6a7d8c0b35 HTTP/1.1
Authorization: Bearer TOKEN
tenant-id: 1
```



URL 传递 token：



```HTTP
GET {ontologyBaseUrl}/open-api/ai/v1/special-equipment/file/preview/7c6e9d2f-3a41-4b8c-9e52-1f6a7d8c0b35?token=TOKEN HTTP/1.1
```



|字段路径|类型|必填|说明|
|---|---|---|---|
|`domainCode`|string|是|路径参数，待预览文件归属领域及 datasource 名称，示例为 `special-equipment`|
|`fileId`|string|是|路径参数，来源版本 UUID，即 `knowledge_source_version.version_id`|
|`Authorization`|string|条件必填|请求头参数，格式为 `Bearer TOKEN`；与 URL token 至少传入一种，两者同时存在时优先使用该参数|
|`token`|string|条件必填|URL 查询参数，JWT 访问令牌；与 `Authorization` 至少传入一种|



### **3\.6 预览文件\-响应**



```HTTP
HTTP/1.1 200 OK
Content-Type: image/png
Content-Disposition: inline; filename=%E9%80%9A%E7%94%B5%E6%A3%80%E6%9F%A5%E6%8E%A5%E7%BA%BF%E7%A4%BA%E6%84%8F%E5%9B%BE.png
Content-Length: <PNG图片字节数>
Accept-Ranges: bytes
Cache-Control: private, max-age=604800, no-transform
ETag: "<图片内容SHA-256>"

<PNG 图片的二进制数据>
```



|字段/响应头|类型|必填|说明|
|---|---|---|---|
|HTTP 状态码|integer|是|`200` 表示预览文件读取成功|
|`Content-Type`|string|是|文件媒体类型；图片按实际格式返回 `image/jpeg`、`image/png`、`image/gif` 或 `image/webp`，示例为 `image/png`|
|`Content-Disposition`|string|是|浏览器展示方式及经过编码的文件名；`inline` 表示优先内嵌预览|
|`Content-Length`|integer|是|响应体字节数|
|`Accept-Ranges`|string|是|是否支持范围请求；`bytes` 表示支持按字节分段读取|
|`Cache-Control`|string|是|客户端及中间缓存策略|
|`ETag`|string|是|文件内容版本标识，用于缓存校验|
|响应体|binary|是|文件二进制内容；示例为 PNG 图片数据|



范围读取和缓存协商规则：



- 不传 `Range` 时返回 `200` 和完整内容。

- 支持 `bytes=start-end`、`bytes=start-`、`bytes=-suffix` 以及逗号分隔的多区间；最多接收 16 段，并合并重叠或相邻区间。

- 单区间返回 `206` 和 `Content-Range`；多区间返回 `206 multipart/byteranges`，每段包含 `Content-Type`、`Content-Range`，总响应设置准确的 `Content-Length`。

- Range 语法错误、没有可满足区间或超过 16 段时返回 `416`、`Content-Range: bytes */{fileSize}` 和空响应体。

- `If-None-Match` 匹配 SHA\-256 ETag 时返回 `304`；存在 `If-Range` 时，仅在其与 ETag 完全匹配时处理 Range，否则返回 `200` 全量内容。

- 正常响应均设置 `Content-Disposition: inline`、`Accept-Ranges: bytes`、`Cache-Control: private, max-age=604800, no-transform` 和 SHA\-256 ETag。

### **3\.7 解析文件\-请求**



#### **接口说明**



用于对本地上传且尚未解析的试验依据文档发起异步内容解析，提取后续生成任务可检索、可引用的文档内容。原型在保存并进入下一步后启动未解析文档的解析；解析状态不阻塞页面切换，但发起功能项试验信息生成前，相关试验依据必须解析成功。



本接口仅接受 PDF、Word 和 Excel 文件的 `fileId`。图片不作为试验依据，客户端不得对图片调用本接口；服务端收到图片 `fileId` 时返回 HTTP `400`，不创建异步任务。



```JSON
{
  "operatorId": "10086",
  "aiTaskId": "2026-04-SXFX-005",
  "fileIds": ["7c6e9d2f-3a41-4b8c-9e52-1f6a7d8c0b35","7c6e9d2f-3a41-4b8c-9e52-1f6a7d8c0b35"]
}
```



|字段路径|类型|必填|说明|
|---|---|---|---|
|`operatorId`|string|是|实际操作人用户 ID|
|`aiTaskId`|string|是|业务侧任务编号，用于关联本次解析请求|
|`fileIds`|string|是|待解析试验依据文档的来源版本 UUID；不允许传入图片文件 UUID|



#### **异常响应**



错误响应沿用平台通用错误结构。



|场景|HTTP 状态码|说明|
|---|---|---|
|`fileId` 对应图片|`400`|图片不支持解析，不创建异步任务|
|文件格式与内容不匹配|`400`|文件类型校验失败，不创建异步任务|
|文件不存在|`404`|`fileId` 不存在或当前用户无权访问|



### **3\.8 解析文件\-任务受理响应**



```JSON
{
  "code": 0,
  "msg": "",
  "data": {
    "aiTaskId": "task_01JABC"
  }
}
```



|字段路径|类型|必填|说明|
|---|---|---|---|
|`code`|integer|是|通用响应码，`0` 表示任务受理成功|
|`msg`|string|是|任务受理结果说明；无补充信息时返回空字符串|
|`data`|object|是|任务受理结果|
|`data.aiTaskId`|string|是|AI 任务唯一标识，用于订阅进度和查询结果|



### **3\.9 解析文件\-订阅任务进度及返回事件**



#### **接口说明**



这是解析文件、功能项试验信息生成和试验方案生成共用的异步任务订阅接口。客户端按 `aiTaskId` 建立 SSE 连接，接收处理阶段、进度、完成或失败状态，并按任务类型取得相应结果，用于更新页面进度、展示失败原因和衔接后续流程。3\.12 和 3\.15 分别给出功能项试验信息生成与试验方案生成场景的响应结构。



订阅请求:

```HTTP
GET {ontologyBaseUrl}/open-api/ai/v1/file-parse/tasks/{aiTaskId}/events
tenant-id: 1
Accept: text/event-stream
```



SSE 响应包含 `PROCESSING`、`COMPLETED` 和 `FAILED` 三类事件，事件名大小写敏感。以下以 `PROCESSING` 事件为例；实际传输时，`data:` 行是下方 JSON 的单行序列化结果：



```Plain Text
event: PROCESSING
id: 1
data: <下方 JSON 的单行序列化结果>
```



```JSON
{
  "progress": 20,
  "processInfo": [
    {"stageStatus":"COMPLETED","stage":"文件1","message":"已完成文件内容读取","stageProgress":100},
    {"stageStatus":"RUNNING","stage":"文件2","message":"正在切分文档内容","stageProgress":20},
    {"stageStatus":"PENDING","stage":"文件3","message":"等待文档切片完成","stageProgress":0}
  ],
  "result": {}
}
```



`PROCESSING`、`COMPLETED` 和 `FAILED` 事件使用相同的 `data` 结构，均包含 `progress`、`processInfo` 和 `result`。事件状态由 `event` 和各阶段的 `stageStatus` 表达；当前解析任务没有业务结果内容，`result` 返回空对象 `{}`。



SSE 协议在线上传输的 `event`、`id` 和 `data` 均为文本行；下表中 `data` 及其下级字段的类型是客户端对 `data:` 内容执行 JSON 反序列化后的类型。每个事件帧以空行结束。



|字段路径|类型|必填|说明|
|---|---|---|---|
|`event`|string|是|SSE 事件类型：`PROCESSING` 表示处理中，`COMPLETED` 表示任务完成，`FAILED` 表示任务失败|
|`id`|string|是|SSE 事件标识，以文本形式传输；示例值为 `1`|
|`data`|object|是|当前事件的 JSON 载荷；三类事件结构相同|
|`data.progress`<br>|integer|是|任务总体完成百分比，取值范围为 `0`～`100`；`COMPLETED` 事件固定为 `100`，`FAILED` 事件保留失败发生时的实际进度|
|`data.processInfo`|array|是|文件读取、切片、向量化和入库各处理阶段的进度信息列表|
|`data.processInfo[]`|object|—|单个处理阶段的进度信息|
|`data.processInfo[].stageStatus`|string|是|阶段状态：`PENDING`\-等待执行、`RUNNING`\-执行中、`COMPLETED`\-执行完成、`FAILED`\-执行失败|
|`data.processInfo[].stage`|string|是|处理阶段名称：`文件读取`、`切片`、`向量化` 或 `入库`|
|`data.processInfo[].message`|string|是|当前阶段的进度、完成情况或失败原因|
|`data.processInfo[].stageProgress`|integer|是|当前阶段完成百分比，取值范围为 `0`～`100`|
|`data.result`|object|是|文件解析结果；当前没有结果内容，返回空对象 `{}`|



### **3\.10 生成功能项试验信息\-请求**



#### **接口说明**



用于在试验依据解析成功后，基于当前方案已保存的基本信息、试验依据、历史方案及本体知识生成可完善的功能项试验信息。生成内容包括前置条件、试验环境、安全注意事项、试验要求、试验资源、功能点及其采用依据、重复依据和待采用建议，为方案正文生成提供结构化输入。

```HTTP
POST {ontologyBaseUrl}/open-api/ai/v1/{planId}/functional-item-generations
Authorization: Bearer TOKEN
tenant-id: 1
```

```JSON
{
  "operatorId": "10086",
  "aiTaskId": "2026-04-SXFX-005",
  "planId": "plan-13",
  "tenantId":1 # 请注意, 此tenantId与header中tenant-id是完全不同的业务含义
}
```



|字段|类型|必填|说明|
|---|---|---|---|
|`planId`|string|是|当前试验方案 ID|
|`operatorId`|string|是|实际操作人用户 ID|
|`aiTaskId`|string|是|业务侧任务编号，用于关联本次生成请求|
|`telnetId`|long|是|业务平台\(例如特设\)租户id|



### **3\.11 生成功能项试验信息\-任务受理响应**



```JSON
{
  "code": 0,
  "msg": "",
  "data": {
    "aiTaskId": "task_01JABC"
  }
}
```



|字段路径|类型|必填|说明|
|---|---|---|---|
|`code`|integer|是|通用响应码，`0` 表示任务受理成功|
|`msg`|string|是|任务受理结果说明；无补充信息时返回空字符串|
|`data`|object|是|任务受理结果|
|`data.aiTaskId`|string|是|AI 任务唯一标识，用于订阅进度和查询结果|



### **3\.12 生成功能项试验信息\-订阅任务进度及返回事件**



订阅请求:

```HTTP
GET {ontologyBaseUrl}/open-api/ai/v1/tasks/{aiTaskId}/events
tenant-id: 1
Accept: text/event-stream
```



SSE 响应包含 `PROCESSING`、`COMPLETED` 和 `FAILED` 三类事件，事件名大小写敏感。以下以 `PROCESSING` 事件为例；实际传输时，`data:` 行是下方 JSON 的单行序列化结果：



```Plain Text
event: PROCESSING
id: 1
data: <下方 JSON 的单行序列化结果>
```



```JSON
{
  "progress": 20,
  "processInfo": [
    {"stageStatus":"RUNNING","stage":"功能项试验信息抽取生成","message":"已完成业务数据准备","stageProgress":20},
    {"stageStatus":"PENDING","stage":"功能点信息抽取生成","message":"等待功能项试验信息生成完成","stageProgress":0}
  ],
  "result": {
    "planId": "plan-13",
    "functionTestInfos": [
      {
        "contentType": "text",
        "contentName": "前置条件",
        "contentGroup": "precondition",
        "isSuggestion": false,
        "adoptionStatus": "adopted",
        "sortNo": 0,
        "content": {
          "text": "确认技术状态正常，并完成外观、接地、连接器和供电极性检查。",
          "resourceItems": [],
          "attachments": []
        },
        "suggestions": [
          {
            "sourceType": "ontology",
            "priority": 3,
            "sourceFileName": "特设工艺本体知识库",
            "contentDescription": "正式检查前完成配置数据备份并核对软硬件版本。",
             "chapter": "第7章 试验实施",
            "location": "7.1 试验准备 · 第3段",
            "recommendation": "该段明确规定试验准备要求。",
            "adoptionStatus": "pending_adoption",
            "sortNo": 0
          }
        ],
        "sourceReferences": [
          {
            "sourceType": "design_file",
            "priority": 1,
            "sourceFileName": "航电任务系统设备通电检查技术要求.docx",
            "chapter": "第7章 试验实施",
            "pageNumber": "第30页",
            "location": "7.1 试验准备 · 第3段",
            "recommendation": "该段明确规定试验准备要求。",
            "adoptedContent": "确认技术状态正常，并完成供电极性检查。",
            "sortNo": 0
          }
        ],
        "duplicateSourceReferences": [
          {
            "sourceType": "knowledge_plan",
            "priority": 2,
            "sourceFileName": "同类航电任务系统设备通电检查试验方案",
            "chapter": "第7章 试验实施",
            "pageNumber": null,
            "location": "7.1 试验准备 · 第3段",
            "recommendation": "历史方案包含语义重复的试验准备要求。",
            "adoptedContent": "确认设备技术状态和应急断电措施。",
            "sortNo": 0
          }
        ]
      },
      {
        "contentType": "text",
        "contentName": "试验环境",
        "contentGroup": "test_environment",
        "isSuggestion": false,
        "adoptionStatus": "adopted",
        "sortNo": 0,
        "content": {
          "text": "确认接地、通风、照明和消防条件满足试验要求。",
          "resourceItems": [],
          "attachments": []
        },
        "suggestions": [],
        "sourceReferences": [],
        "duplicateSourceReferences": []
      },
      {
        "contentType": "text",
        "contentName": "安全注意事项",
        "contentGroup": "safety_precaution",
        "isSuggestion": false,
        "adoptionStatus": "adopted",
        "sortNo": 0,
        "content": {
          "text": "严格执行先检查后通电、先断电后拆线；出现异常时立即断电。",
          "resourceItems": [],
          "attachments": []
        },
        "suggestions": [],
        "sourceReferences": [],
        "duplicateSourceReferences": []
      },
      {
        "contentType": "text_image",
        "contentName": "通电检查记录要求",
        "contentGroup": "test_requirement",
        "isSuggestion": false,
        "adoptionStatus": "adopted",
        "sortNo": 0,
        "content": {
          "text": "按规定时序受控上电并记录关键参数。",
          "resourceItems": [],
          "attachments": [
            {
              "name": "图4-1 通电检查接线示意图.png",
              "type": "IMAGE",
              "source": "AUTO_EXTRACTED",
              "originalSourceDocumentName": "航电任务系统设备通电检查技术要求.docx",
              "chapter": "第4章 · 4.2.1 · 第12页 · 图4-1",
              "fileId": "18a4c6e2-5b73-4d90-a1f8-2c6e9b7d3045",
              "imageUrl": "/open-api/ai/v1/special-equipment/file/preview/18a4c6e2-5b73-4d90-a1f8-2c6e9b7d3045"
            }
          ]
        },
        "suggestions": [],
        "sourceReferences": [],
        "duplicateSourceReferences": []
      },
      {
        "contentType": "table",
        "contentName": "试验资源",
        "contentGroup": "test_resource",
        "isSuggestion": false,
        "adoptionStatus": "adopted",
        "sortNo": 0,
        "content": {
          "text": null,
          "resourceItems": [
            {
              "equipmentName": "程控直流电源",
              "purpose": "提供受控 DC 28V 供电",
              "sortNo": 0
            }
          ],
          "attachments": []
        },
        "suggestions": [],
        "sourceReferences": [],
        "duplicateSourceReferences": []
      },
      {
        "contentType": "text",
        "contentName": "配置数据备份要求",
        "contentGroup": "test_requirement",
        "isSuggestion": true,
        "adoptionStatus": "pending_adoption",
        "sortNo": 1,
        "content": {
          "text": "正式检查前完成配置数据备份。",
          "resourceItems": [],
          "attachments": []
        },
        "suggestions": [],
        "sourceReferences": [],
        "duplicateSourceReferences": []
      }
    ],
    "functionPoints": [
      {
        "pointName": "供电接口与绝缘检查",
        "pointOrigin": "generated",
        "sourceType": null,
        "adoptionStatus": "adopted",
        "sourceReferences": [
          {
            "sourceType": "design_file",
            "priority": 1,
            "sourceFileName": "航电任务系统设备通电检查技术要求.docx",
            "chapter": "技术要求 §4.2",
            "pageNumber": "第13页",
            "location": "功能点条款",
            "recommendation": "验证供电接口与绝缘检查满足技术要求。",
            "adoptedContent": "确认供电极性、回路通断和绝缘检查符合要求。",
            "sortNo": 0
          }
        ],
        "fields": [
          {
            "fieldType": "logic_relation",
            "fieldName": "试验方式",
            "fieldOrigin": "generated",
            "sortNo": 0,
            "fieldContent": {
              "text": "万用表通断测量与绝缘电阻测试",
              "attachments": []
            },
            "suggestions": [
              {
                "sourceType": "ontology",
                "sourceFileName": "特设工艺本体知识库",
                "contentDescription": "建议增加微欧计复测。",
                "sourceDetail": "知识条目 TS-ELEC-02",
                "adoptionStatus": "pending_adoption"
              }
            ],
            "sourceReferences": []
          },
          {
            "fieldType": "logic_relation",
            "fieldName": "接口操作",
            "fieldOrigin": "generated",
            "sortNo": 0,
            "fieldContent": {
              "text": "检查供电、接地、总线及维护接口连接状态。",
              "attachments": [
                {
                  "resourceType": "attachment",
                  "fileId": "2f9b7c41-6d85-4ea3-b0c7-5a1d8e9f2634",
                  "fileName": "通电检查记录表.xlsx",
                  "fileType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                  "fileSize": 18240,
                  "fileUrl": "/open-api/ai/v1/special-equipment/file/preview/2f9b7c41-6d85-4ea3-b0c7-5a1d8e9f2634",
                  "sortNo": 0
                }
              ]
            },
            "suggestions": [],
            "sourceReferences": []
          }
        ]
      },
      {
        "pointName": "接地连续性复查",
        "pointOrigin": "suggestion",
        "sourceType": "ontology",
        "adoptionStatus": "pending_adoption",
        "sourceReferences": [
          {
            "sourceType": "ontology",
            "priority": 1,
            "sourceFileName": "特设工艺本体知识库",
            "chapter": "接地连续性规则",
            "pageNumber": null,
            "location": "知识条目 TS-GND-01",
            "recommendation": "建议在断电后复查关键接地点。",
            "adoptedContent": "复查设备、机壳与飞机接地系统的搭接电阻。",
            "sortNo": 0
          }
        ],
        "fields": []
      }
    ]
  }
}
```



路径表达式约定：`{a,b}` 表示分别展开为 `a` 和 `b`。路径表达式仅用于复用公共结构，不表示向 JSON 新增字段。



`PROCESSING`、`COMPLETED` 和 `FAILED` 事件使用相同的 `data` 结构，均包含 `progress`、`processInfo` 和 `result`。三类事件必须返回 `result`，不得返回空对象或省略该字段。`PROCESSING` 和 `FAILED` 返回任务在当前时刻已经生成的快照，尚未生成的列表返回 `[]`；只有 `COMPLETED` 事件的 `result` 保证满足保存接口的完整快照校验，可直接作为 `/protocol/test-plan/function-info/save` 的请求体。



生成结果用于新增或完全替换已有快照，因此不返回功能项、功能点、字段、建议、来源依据及字段附件的业务 `id`。其他程序在落库或后续查询时填充这些 `id`；文件基础设施生成的 `fileId` 仍按附件契约返回。



SSE 协议在线上传输的 `event`、`id` 和 `data` 均为文本行；下表中 `data` 及其下级字段的类型是客户端对 `data:` 内容执行 JSON 反序列化后的类型。每个事件帧以空行结束。



|字段路径|类型|必填|说明|
|---|---|---|---|
|`event`|string|是|SSE 事件类型：`PROCESSING` 表示处理中，`COMPLETED` 表示任务完成，`FAILED` 表示任务失败|
|`id`|string|是|SSE 事件标识，以文本形式传输；示例值为 `1`|
|`data`|object|是|当前事件的 JSON 载荷；三类事件结构相同|
|`data.progress`|integer|是|任务总体完成百分比，取值范围为 `0`～`100`；`COMPLETED` 固定为 `100`，`FAILED` 保留失败时的实际进度|
|`data.processInfo`|array|是|各处理阶段的进度信息列表|
|`data.processInfo[]`|object|—|单个处理阶段的进度信息|
|`data.processInfo[].stageStatus`|string|是|阶段状态：`PENDING`、`RUNNING`、`COMPLETED` 或 `FAILED`|
|`data.processInfo[].stage`|string|是|处理阶段名称|
|`data.processInfo[].message`|string|是|当前阶段的进度、完成情况或失败原因|
|`data.processInfo[].stageProgress`|integer|是|当前阶段完成百分比，取值范围为 `0`～`100`|
|`data.result`|object|是|当前已生成的功能项与功能点快照；三类事件均返回且不为空对象|
|`data.result.planId`|string|是|当前试验方案主键，与生成请求中的 `planId` 一致|
|`data.result.functionTestInfos`|array|是|功能项试验信息完整快照；尚无结果时返回 `[]`|
|`data.result.functionTestInfos[]`|object|—|单个功能项试验信息；生成结果不返回 `id`|
|`data.result.functionTestInfos[].contentType`|string|是|内容类型：`text`、`table` 或 `text_image`|
|`data.result.functionTestInfos[].contentName`|string|是|内容名称，最多 200 个字符|
|`data.result.functionTestInfos[].contentGroup`|string|是|内容分组：`precondition`、`test_environment`、`safety_precaution`、`test_requirement` 或 `test_resource`|
|`data.result.functionTestInfos[].isSuggestion`|boolean|是|是否为建议新增的试验要求项；建议新增项只能属于 `test_requirement`|
|`data.result.functionTestInfos[].adoptionStatus`|string|是|采用状态：`pending_adoption`、`adopted` 或 `ignored`|
|`data.result.functionTestInfos[].sortNo`|integer|是|当前分组内的展示顺序，大于或等于 0|
|`data.result.functionTestInfos[].content`|object|是|结构化正文|
|`data.result.functionTestInfos[].content.text`|string/null|条件必填|文本正文；试验资源传 `null`，其他分组必填|
|`data.result.functionTestInfos[].content.resourceItems`|array|条件必填|试验资源表格行；`test_resource` 必填，其他分组返回 `[]`|
|`data.result.functionTestInfos[].content.resourceItems[]`|object|—|单个设备或工装|
|`data.result.functionTestInfos[].content.resourceItems[].equipmentName`|string|是|设备或工装名称，最多 100 个字符|
|`data.result.functionTestInfos[].content.resourceItems[].purpose`|string|否|主要用途，最多 500 个字符|
|`data.result.functionTestInfos[].content.resourceItems[].sortNo`|integer|是|表格行展示顺序，大于或等于 0|
|`data.result.functionTestInfos[].content.attachments`|array|否|试验要求的图片和表格文件，最多 10 个；无数据时返回 `[]`|
|`data.result.functionTestInfos[].content.attachments[]`|object|—|单个试验要求附件|
|`data.result.functionTestInfos[].content.attachments[].name`|string|是|附件名称，同一试验要求内不得重名|
|`data.result.functionTestInfos[].content.attachments[].type`|string|是|附件类型：`TABLE` 或 `IMAGE`|
|`data.result.functionTestInfos[].content.attachments[].source`|string|是|附件产生方式：`AUTO_EXTRACTED` 或 `MANUAL_UPLOADED`|
|`data.result.functionTestInfos[].content.attachments[].originalSourceDocumentName`|string|否|原始来源文档名称|
|`data.result.functionTestInfos[].content.attachments[].chapter`|string|否|原始来源章节及页码位置|
|`data.result.functionTestInfos[].content.attachments[].fileId`|string|是|附件来源版本 UUID；手工上传图片取 `upload-files` 返回的 `fileId`，该文件标识不属于需省略的业务 `id`|
|`data.result.functionTestInfos[].content.attachments[].imageUrl`|string|图片必填|图片预览地址；地址本身不携带 token，调用时通过 `Authorization` 请求头或 `token` 查询参数鉴权；表格文件不返回|
|`data.result.functionTestInfos[].suggestions`|array|否|补充建议快照；无数据时返回 `[]`|
|`data.result.functionTestInfos[].suggestions[]`|object|—|单条补充建议；生成结果不返回 `id`|
|`data.result.functionTestInfos[].suggestions[].sourceType`|string|是|来源类型：`ontology`、`design_file`、`knowledge_plan` 或 `manual`|
|`data.result.functionTestInfos[].suggestions[].priority`|integer|是|优先级，取值范围为 0～9999，数值越小优先级越高|
|`data.result.functionTestInfos[].suggestions[].sourceFileName`|string|否|来源文件名称或来源名称|
|`data.result.functionTestInfos[].suggestions[].contentDescription`|string|是|建议正文，最多 2000 个字符|
|`data.result.functionTestInfos[].suggestions[].adoptionStatus`|string|是|建议处理状态：`pending_adoption`、`adopted` 或 `ignored`|
|`data.result.functionTestInfos[].suggestions[].sortNo`|integer|是|建议展示顺序，大于或等于 0|
|`data.result.functionTestInfos[].{sourceReferences,duplicateSourceReferences}`|array|否|已采用来源依据或重复来源依据快照；无数据时返回 `[]`|
|`data.result.functionTestInfos[].{sourceReferences[],duplicateSourceReferences[]}`|object|—|来源依据元素；生成结果不返回 `id`，字段见公共来源依据|
|`data.result.functionPoints`|array|是|功能点完整快照；处理中尚无结果时可为 `[]`，完成时正式功能点为 1～100 个|
|`data.result.functionPoints[]`|object|—|单个正式或建议补充功能点；生成结果不返回 `id`|
|`data.result.functionPoints[].pointName`|string|是|功能点名称，最多 50 个字符；正式功能点在同一方案内不得重名|
|`data.result.functionPoints[].pointOrigin`|string|是|功能点来源：`generated`、`suggestion` 或 `manual`|
|`data.result.functionPoints[].sourceType`|string/null<br>|条件必填|建议补充功能点必填，取值为 `knowledge_plan` 或 `ontology`；其他功能点返回 `null`|
|`data.result.functionPoints[].adoptionStatus`|string<br>|是|采用状态：`pending_adoption`、`adopted` 或 `ignored`|
|`data.result.functionPoints[].sourceReferences`|array|否|功能点来源依据快照；无数据时返回 `[]`|
|`data.result.functionPoints[].sourceReferences[]`|object|—|功能点来源依据；生成结果不返回 `id`，字段见公共来源依据|
|`data.result.functionPoints[].fields`|array|否|功能点字段快照；无数据时返回 `[]`|
|`data.result.functionPoints[].fields[]`|object|—|单个功能点字段；生成结果不返回 `id`|
|`data.result.functionPoints[].fields[].fieldType`<br>|string|是|字段分组：function\_performance\_requirement（功能/性能要求）、logic\_relation（逻辑关系）|
|`data.result.functionPoints[].fields[].fieldName`|string|是|字段名称，最多 50 个字符|
|`data.result.functionPoints[].fields[].fieldOrigin`|string|是|字段来源：`generated` 或 `manual`|
|`data.result.functionPoints[].fields[].sortNo`|integer|是|字段展示顺序，大于或等于 1|
|`data.result.functionPoints[].fields[].fieldContent`|object|是|字段正文和附件元数据|
|`data.result.functionPoints[].fields[].fieldContent.text`|string|是|字段文本内容，最多 20000 个字符|
|`data.result.functionPoints[].fields[].fieldContent.attachments`|array|否|字段附件，最多 10 个，仅 `operation_requirement` 允许返回；无数据时返回 `[]`|
|`data.result.functionPoints[].fields[].fieldContent.attachments[]`|object|—|单个字段附件；生成结果不返回可选业务 `id`|
|`data.result.functionPoints[].fields[].fieldContent.attachments[].resourceType`|string|是|资源类型：`image` 或 `attachment`|
|`data.result.functionPoints[].fields[].fieldContent.attachments[].fileId`|string|是|来源版本 UUID；手工上传图片取 `upload-files` 返回的 `fileId`|
|`data.result.functionPoints[].fields[].fieldContent.attachments[].fileName`|string|是|文件展示名称|
|`data.result.functionPoints[].fields[].fieldContent.attachments[].fileType`|string|是|文件媒体类型|
|`data.result.functionPoints[].fields[].fieldContent.attachments[].fileSize`|integer|是|文件大小，单位字节，取值范围为 1～52428800|
|`data.result.functionPoints[].fields[].fieldContent.attachments[].fileUrl`|string|是|文件预览地址；地址本身不携带 token，调用时通过 `Authorization` 请求头或 `token` 查询参数鉴权|
|`data.result.functionPoints[].fields[].fieldContent.attachments[].sortNo`|integer|是|文件展示顺序，大于或等于 0|
|`data.result.functionPoints[].fields[].suggestions`|array|否|字段建议快照；无数据时返回 `[]`|
|`data.result.functionPoints[].fields[].suggestions[]`|object|—|单条字段建议；生成结果不返回 `id`|
|`data.result.functionPoints[].fields[].suggestions[].sourceType`|string|是|建议来源类型：`ontology`、`design_file`、`knowledge_plan` 或 `manual`|
|`data.result.functionPoints[].fields[].suggestions[].sourceFileName`|string|是|来源文件名称或来源名称|
|`data.result.functionPoints[].fields[].suggestions[].contentDescription`|string|是|建议正文，最多 2000 个字符|
|`data.result.functionPoints[].fields[].suggestions[].sourceDetail`|string|是|来源章节或知识条目明细，最多 200 个字符|
|`data.result.functionPoints[].fields[].suggestions[].adoptionStatus`|string|是|建议处理状态：`pending_adoption`、`adopted` 或 `ignored`|
|`data.result.functionPoints[].fields[].sourceReferences`|array|否|字段已采用来源依据快照；无数据时返回 `[]`|
|`data.result.functionPoints[].fields[].sourceReferences[]`|object|—|字段来源依据；生成结果不返回 `id`，字段见公共来源依据|
|`data.result.{functionTestInfos[].sourceReferences[],functionTestInfos[].duplicateSourceReferences[],functionPoints[].sourceReferences[],functionPoints[].fields[].sourceReferences[]}.sourceType`|string|是|来源类型：`ontology`、`design_file`、`knowledge_plan` 或 `manual`|
|`data.result.{functionTestInfos[].sourceReferences[],functionTestInfos[].duplicateSourceReferences[],functionPoints[].sourceReferences[],functionPoints[].fields[].sourceReferences[]}.priority`|integer|是|依据优先级，取值范围为 0～9999|
|`data.result.{functionTestInfos[].sourceReferences[],functionTestInfos[].duplicateSourceReferences[],functionPoints[].sourceReferences[],functionPoints[].fields[].sourceReferences[]}.sourceFileName`|string|否|AI 返回的来源文档或知识库名称|
|`data.result.{functionTestInfos[].sourceReferences[],functionTestInfos[].duplicateSourceReferences[],functionPoints[].sourceReferences[],functionPoints[].fields[].sourceReferences[]}.chapter`|string|否|来源章节或本体知识规则分类|
|`data.result.{functionTestInfos[].sourceReferences[],functionTestInfos[].duplicateSourceReferences[],functionPoints[].sourceReferences[],functionPoints[].fields[].sourceReferences[]}.pageNumber`|string/null|否|来源页码；没有页码时返回 `null`|
|`data.result.{functionTestInfos[].sourceReferences[],functionTestInfos[].duplicateSourceReferences[],functionPoints[].sourceReferences[],functionPoints[].fields[].sourceReferences[]}.location`|string|否|小节、段落、条款或知识条目定位|
|`data.result.{functionTestInfos[].sourceReferences[],functionTestInfos[].duplicateSourceReferences[],functionPoints[].sourceReferences[],functionPoints[].fields[].sourceReferences[]}.recommendation`|string|否|推荐理由或重复说明|
|`data.result.{functionTestInfos[].sourceReferences[],functionTestInfos[].duplicateSourceReferences[],functionPoints[].sourceReferences[],functionPoints[].fields[].sourceReferences[]}.adoptedContent`|string/null|否|从来源依据中实际采用的内容|
|`data.result.{functionTestInfos[].sourceReferences[],functionTestInfos[].duplicateSourceReferences[],functionPoints[].sourceReferences[],functionPoints[].fields[].sourceReferences[]}.sortNo`|integer|是|依据展示顺序，大于或等于 0|



建议补充功能点必须传 `pointOrigin=suggestion`，并至少返回一条 `sourceType` 与功能点 `sourceType` 一致的来源依据。普通功能项传 `isSuggestion=false` 且 `adoptionStatus=adopted`；建议新增功能项只允许属于 `test_requirement` 分组，传 `isSuggestion=true`。



### **3\.13 生成试验方案\-请求**



#### **接口说明**



用于根据已确认的功能项试验信息、试验依据和平台知识生成完整的试验方案章节。生成结果进入原型第三步的方案编辑审查页，供方案编制人员逐章编辑、保存、审查并导出最终方案。



```HTTP
curl --connect-timeout 10 --max-time 210 \
  -X POST \
  'http://10.21.1.55:48080/open-api/poc/test-plan/generate' \
  -H 'tenant-id: 1' \
  -H 'X-Request-Id: third-party-syfa-20260827-001' \
  -H 'Content-Type: application/json' \
  -d '{
    "operatorId": "third-party-operator",
    "planId": "79cb3d994071a7560497d04011573696",
    "tenantId": 1
  }'
```

body:

```JSON
{
  "operatorId": "10086",
  "aiTaskId": "2026-04-SXFX-005",
  "planId": "plan-13"
}
```



|字段|类型|必填|说明|
|---|---|---|---|
|`planId`|string|是|当前试验方案 ID|
|`operatorId`|string|是|实际操作人用户 ID|
|`aiTaskId`|string|是|业务侧任务编号，用于关联本次生成请求|



### **3\.14 生成试验方案\-任务受理响应**



```JSON
{
  "code": 0,
  "msg": "",
  "data": {
    "aiTaskId": "task_01JABC"
  }
}
```



|字段路径|类型|必填|说明|
|---|---|---|---|
|`code`|integer|是|通用响应码，`0` 表示任务受理成功|
|`msg`|string|是|任务受理结果说明；无补充信息时返回空字符串|
|`data`|object|是|任务受理结果|
|`data.aiTaskId`|string|是|AI 任务唯一标识，用于订阅进度和查询结果|



### **3\.15 生成试验方案\-订阅任务进度及返回事件**



订阅请求:

```HTTP
GET {ontologyBaseUrl}/open-api/ai/v1/tasks/{aiTaskId}/events
tenant-id: 1
Accept: text/event-stream
```



SSE 响应包含 `PROCESSING`、`COMPLETED` 和 `FAILED` 三类事件，事件名大小写敏感。以下以 `PROCESSING` 事件为例；实际传输时，`data:` 行是下方 JSON 的单行序列化结果：



```Plain Text
event: PROCESSING
id: 1
data: <下方 JSON 的单行序列化结果>
```



```JSON
{
  "progress": 20,
  "processInfo":[
    {"stageStatus":"RUNNING","stage":"汇总功能项试验信息","message":"整理已确认的功能点、试验要求与约束条件","stageProgress":20},
    {"stageStatus":"PENDING","stage":"解析试验依据","message":"提取主要依据文件中的适用条款与技术指标","stageProgress":0},
    {"stageStatus":"COMPLETED","stage":"匹配本体知识库","message":"关联试验资源、规则、流程及历史方案知识","stageProgress":100},
    {"stageStatus":"FAILED","stage":"生成试验方案章节","message":"编制方案目录并生成各章节内容","stageProgress":100},
    {"stageStatus":"FAILED","stage":"完成方案编制","message":"检查章节完整性并准备进入编辑审查","stageProgress":100}
  ],
  "result": {
    "chapters":[
      {
        "chapterNo":"★",
        "name":"封面",
        "content":"<div contenteditable=\"true\" role=\"textbox\" translate=\"no\" class=\"tiptap ProseMirror\" tabindex=\"0\"><h1 style=\"text-align: center;\"><strong>123试验方案</strong></h1><p><br class=\"ProseMirror-trailingBreak\"></p><div class=\"tableWrapper\"><table style=\"min-width: 50px;\"><colgroup><col style=\"min-width: 25px;\"><col style=\"min-width: 25px;\"></colgroup><tbody><tr><td colspan=\"1\" rowspan=\"1\"><p><strong>密级</strong></p></td><td colspan=\"1\" rowspan=\"1\"><p>内部</p></td></tr><tr><td colspan=\"1\" rowspan=\"1\"><p><strong>方案编号</strong></p></td><td colspan=\"1\" rowspan=\"1\"><p>SY-2026-0107</p></td></tr><tr><td colspan=\"1\" rowspan=\"1\"><p><strong>版本号</strong></p></td><td colspan=\"1\" rowspan=\"1\"><p>V1.0</p></td></tr><tr><td colspan=\"1\" rowspan=\"1\"><p><strong>编制单位</strong></p></td><td colspan=\"1\" rowspan=\"1\"><p>xxx单位</p></td></tr><tr><td colspan=\"1\" rowspan=\"1\"><p><strong>编制日期</strong></p></td><td colspan=\"1\" rowspan=\"1\"><p>2026年8月</p></td></tr></tbody></table></div><p><br class=\"ProseMirror-trailingBreak\"></p></div>",
        "attachments":[]
      },
      {
        "chapterNo":"01",
        "name":"范围",
        "content":"<div contenteditable=\"true\" role=\"textbox\" translate=\"no\" class=\"tiptap ProseMirror\" tabindex=\"0\"><h1>01　范围</h1><p>本方案规定了xxxx航电任务系统设备通电检查的范围、依据、检查内容、组织分工、资源、流程、指标和方法。</p><p>本方案适用于航电任务系统装机状态下的库内地面首次通电、维护后恢复通电及联试前状态确认。检查覆盖设备外观与连接、供电接口与绝缘、上电时序、输入电压与电流、状态告警、加电自检、航电总线通信以及正常断电复查。</p></div>",
        "attachments":[
          {
            "sourceType": "design_file",
            "priority": 1,
            "sourceFileName": "航电任务系统设备通电检查技术要求.docx",
            "chapter": "第7章 试验实施",
            "pageNumber": "第30页",
            "location": "7.1 试验准备 · 第3段",
            "recommendation": "该段明确规定试验准备要求。",
            "adoptedContent": "确认技术状态正常，并完成供电极性检查。",
            "sortNo": 0
          }
        ]
      }
    ]
  }
}
```



`PROCESSING`、`COMPLETED` 和 `FAILED` 事件使用相同的 `data` 结构，均包含 `processInfo` 和 `result`。事件状态由 `event` 表达；终态事件不会省略 `result`。



SSE 协议在线上传输的 `event`、`id` 和 `data` 均为文本行；下表中 `data` 及其下级字段的类型是客户端对 `data:` 内容执行 JSON 反序列化后的类型。每个事件帧以空行结束。



|字段路径|类型|必填|说明|
|---|---|---|---|
|`event`|string|是|SSE 事件类型：`PROCESSING` 表示处理中，`COMPLETED` 表示任务完成，`FAILED` 表示任务失败|
|`id`|string|是|SSE 事件标识，以文本形式传输；示例值为 `1`|
|`data`|object|是|当前事件的 JSON 载荷；三类事件结构相同|
|`data.progress`|integer|是|任务总体完成百分比，取值范围为 `0`～`100`；`COMPLETED` 事件固定为 `100`，`FAILED` 事件保留失败发生时的实际进度|
|`data.processInfo`|array|是|各处理阶段的进度信息列表|
|`data.processInfo[]`|object|—|单个处理阶段的进度信息|
|`data.processInfo[].stageStatus`|string|是|阶段状态：`PENDING`\-等待执行、`RUNNING`\-执行中、`COMPLETED`\-执行完成、`FAILED`\-执行失败|
|`data.processInfo[].stage`|string|是|处理阶段名称|
|`data.processInfo[].message`|string|是|当前阶段的进度、完成情况或失败原因|
|`data.processInfo[].stageProgress`|integer|是|当前阶段完成百分比，取值范围为 `0`～`100`|
|`data.result`|object|是|试验方案生成结果；三类事件均返回该字段|
|`data.result.chapters`|array|是|生成的方案章节列表|
|`data.result.chapters[]`|object|—|单个方案章节|
|`data.result.chapters[].chapterNo`|string|是|章节编号；封面固定返回 `★`，其他章节返回字符串编号，如 `01`|
|`data.result.chapters[].name`|string|是|章节名称|
|`data.result.chapters[].content`|string|是|章节 HTML 内容|
|`data.result.chapters[].attachments`|array|是|章节附件列表；无附件时返回 `[]`|
|`data.result.chapters[].attachments[]`|object|—|单个章节附件；复用功能点字段的通用文件资源结构，但不返回业务 `id`|
|`data.result.chapters[].attachments[].sourceType`|string|否|design\_file|
|`data.result.chapters[].attachments[].priority`|string|否<br>|优先级|
|`data.result.chapters[].attachments[].sourceFileName`|string|否|源文件名称|
|`data.result.chapters[].attachments[].chapter`|string|否<br>|章节|
|`data.result.chapters[].attachments[].pageNumber`|string|否|页码|
|`data.result.chapters[].attachments[].location`|string|否|段落|
|`data.result.chapters[].attachments[].recommendation`|string|否|推荐原因|
|`data.result.chapters[].attachments[].adoptedContent`|string|否|采纳内容<br>|
|`data.result.chapters[].attachments[].sortNo`|integer|否|排序|



章节 `attachments` 为必填字段，完整复用功能点字段的通用文件资源结构，但不返回业务 `id`；后续程序可自行填充该字段。`fileId` 使用 UUID 字符串，`fileUrl` 使用统一文件预览路径。





## **4\. 业务应用接口**

### 第三方获取 AI 使用的试验方案完整数据

请求地址：http://120\.232\.136\.52:8095/admin\-api

|接口|用途|是否返回完整结果|
|---|---|---|
|`POST `/third/protocol/test\-plan/getAiTestPlanData|查询试验方案详细信息|是|

4\.1 接口说明

供第三方 AI 一次获取指定租户下试验方案的第一步基本信息和第二步功能项、功能点完整快照。接口无需登录，服务端使用请求体中的 tenantId 执行租户隔离查询。

4\.2 请求信息

```HTTP
POST /third/protocol/test-plan/getAiTestPlanData
Content-Type: application/json

{
  "tenantId": 1,
  "planId": "6f43dd4496a84e86934b85d62ab052a1"
}
```

4\.3 请求参数

4\.4 成功响应示例

```JSON
{
  "code": 0,
  "msg": "",
  "data": {
    "basicInfo": {
      "id": "6f43dd4496a84e86934b85d62ab052a1",
      "planNo": "SY-2026-0015",
      "planName": "XX-1通信系统通信终端CT-100通信链路功能性试验方案",
      "status": "editing",
      "completedStep": 2,
      "productModelName": "XX-1通信系统",
      "targetName": "通信终端CT-100",
      "functionName": "通信链路功能性",
      "planType": "test",
      "testType": "ground_test",
      "testStages": ["aircraft_platform_function_test"],
      "implementationUnit": "XX试验中心",
      "objectiveDescription": "验证通信终端链路建立、数据收发及异常恢复能力。",
      "historyPlanId": null,
      "historyPlanName": null,
      "sourceFiles": []
    },
    "functionInfo": {
      "planId": "6f43dd4496a84e86934b85d62ab052a1",
      "status": "editing",
      "functionTestInfos": [],
      "functionPoints": []
    }
  }
}
```

4\.5 响应参数

4\.5\.1 basicInfo 字段

4\.5\.2 functionInfo 字段

4\.5\.3 功能项试验信息字段

4\.5\.4 功能点字段

4\.5\.5 通用嵌套字段

来源依据字段同时适用于 sourceReferences\[\]、duplicateSourceReferences\[\] 及字段来源依据列表。

4\.6 异常响应

```JSON
{
  "code": 1053000000,
  "data": null,
  "msg": "试验方案不存在"
}
```

### 保存试验方案第二步信息

保存功能项试验信息与功能点的完整快照。保存成功后，方案已完成步骤更新为第 3 步，并异步触发试验方案正文生成；正文生成任务已存在时，本次数据仍会保存，但不重复提交生成任务。

```Plain Text
POST /admin-api/protocol/test-plan/function-info/save
Content-Type: application/json
Authorization: Bearer <登录令牌>
```

```Plain Text
{
  "planId": "6f43dd4496a84e86934b85d62ab052a1",
  "functionTestInfos": [
    {
      "contentType": "text",
      "contentName": "试验对象",
      "contentGroup": "test_object",
      "isSuggestion": false,
      "adoptionStatus": "adopted",
      "sortNo": 0,
      "content": {
        "text": "待试验设备及其相关接口。",
        "resourceItems": [],
        "attachments": []
      },
      "suggestions": [],
      "sourceReferences": [],
      "duplicateSourceReferences": []
    }
  ],
  "functionPoints": [
    {
      "pointName": "设备通电检查",
      "pointOrigin": "manual",
      "adoptionStatus": "adopted",
      "sourceReferences": [],
      "fields": [
        {
          "fieldType": "logic_relation",
          "fieldName": "试验方式",
          "fieldOrigin": "manual",
          "adoptionStatus": "adopted",
          "sortNo": 0,
          "fieldContent": {
            "text": "确认供电极性、回路通断及绝缘状态符合要求。",
            "attachments": []
          },
          "suggestions": [],
          "sourceReferences": []
        }
      ]
    }
  ]
}
```

### 功能项试验信息字段

### 功能点及字段

### 正文与附件规则

附件字段包括 `name`、`type`、`source`、`originalSourceDocumentName`、`chapter`、`fileId`、`imageUrl`。`type=IMAGE` 时必须传 `imageUrl`；`type=TABLE` 时不得传 `imageUrl`。

### 保存规则

1. 接口按完整快照保存，不支持只提交局部修改数据。

2. 已有记录更新时必须回传原 `id`；未回传的已有功能项、功能点、字段、依据和建议会被删除。

3. 子列表未传时按空数组处理，会清空对应已有子记录。

4. 功能项、功能点、字段、来源依据和建议任一保存失败时，整体回滚。

5. 返回 `data=true` 仅表示保存受理成功；正文生成进度通过 `GET /admin-api/protocol/test-plan/ai-task-progress/plan-document-generation/{planId}` 查询。

```Plain Text
{
  "code": 0,
  "msg": "",
  "data": true
}
```



