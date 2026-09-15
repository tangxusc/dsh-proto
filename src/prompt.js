/**
 * 提示词段：告诉模型怎么把两个工具串起来完成「取数 → 逐章生成文档」。
 *
 * 通过 ctx.systemPrompt.section() 贡献；order 用自定义数字（外部插件不能用
 * getSectionOrder 的预定义键，那三个键都属于仓库内部）。位置放在工具说明区，
 * 紧邻 TOOLS_SDK（5000），与 TOOL_* 系列同段。
 */

/** 本插件提示词段的顺序（外部插件用自定义有限数）。 */
const SECTION_ORDER = 5100

/**
 * 组装提示词文本。章节要求来自章节目录，避免两处维护。
 * @param chapters - 章节目录（来自 src/chapters.js）。
 * @returns 提示词段文本。
 */
export function buildPrompt(chapters) {
  const brief = chapters.map((c) => `${c.no} ${c.name}`).join('；')
  return `【试验方案文档生成】
当用户要求生成试验方案文档时，按以下顺序使用工具，不要跳步：

1. 先用 get_test_plan_info 取数，传入用户给出的 planId。该工具会返回方案的全部数据
   （basicInfo、functionInfo 等），并把方案身份与已采纳功能点记入会话状态。
2. 取数成功后，用 write_chapter 逐章写入，共 12 章：封面（cover）、05、以及
   ${brief}。每章单独调用一次 write_chapter，不要合并。
3. 全部 12 章写完后，write_chapter 会自动把整份文档落盘，并在返回值里给出 documentPath。
   把该路径告知用户。

write_chapter 的用法：
- chapterNo 传章节编号；blocks 传结构化正文块，不要写 HTML（HTML 由程序按模版渲染）。
- 块类型：paragraph（段落）、heading（小标题）、list（列表，用 items）、
  table（表格，用 columns 与 rows，每行列数须等于列头数）。
- 封面（cover）与 05 章由程序渲染，忽略你传入的 blocks：封面取方案名称/编号/型号/系统名，
  05 章只列已采纳功能点目录。这两章仍需调用 write_chapter，以使流程完整。
- 没有原文支持的内容不要编造。组织、人员、设备状态等建议性内容，把该块的
  recommendation 设为 true，文档中会标注「建议（待确认）」。
- 第 09 章的「状态」列只能是：正常、校准中、维修中、不可用、待确认。

内容要求：只依据 get_test_plan_info 返回的数据组织正文，不编造技术限值、文件编号、日期、
部门或人数；信息缺失写「待确认」，不要用泛化总结替代细节。`
}

/**
 * 注册提示词段。
 * @param ctx - 携带 systemPrompt 服务的插件上下文。
 * @param chapters - 章节目录。
 */
export function registerPrompt(ctx, chapters) {
  ctx.systemPrompt.section({
    name: 'tool:test-plan-doc',
    order: SECTION_ORDER,
    text: buildPrompt(chapters),
  })
}
