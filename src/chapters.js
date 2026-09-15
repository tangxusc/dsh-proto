/**
 * 试验方案章节目录：编号、名称、生成规则。
 *
 * instructions 是该章的编写要求，会作为工具对模型的约束下发。参照自
 * ontology-ai-runtime 的 plan_doc_generation/catalog.py，此处只保留本插件需要的部分。
 */

/** 全部章节，按公文顺序。 */
export const CHAPTERS = [
  { no: '01', name: '范围', instructions: '归纳试验目的、适用产品和阶段、地点时机、覆盖内容及明确边界。' },
  { no: '02', name: '规范性引用文件', instructions: '仅汇编标准和试验依据文件的类型、编号、名称及用途。文件编号缺失用—，禁止编造标准。' },
  { no: '03', name: '术语定义', instructions: '提取本方案专业术语、英文或缩写和定义，过滤无关通用词语，按表格组织。' },
  { no: '04', name: '系统简介', instructions: '说明系统用途、组成、工作原理、数据交互及供电、温度、频率等已知工作条件。' },
  { no: '05', name: '试验项目', instructions: '只展示已采纳功能点数量和标题目录，不展示明细。' },
  { no: '06', name: '试验注意事项', instructions: '按准备、实施、异常处置和收尾说明安全注意事项，保留禁止操作和中止条件。' },
  { no: '07', name: '分离面设计原则', instructions: '根据试验接口和历史方案明确负责部门、职责边界及交接条件。未知组织名称不虚构；推荐的岗位分工标记为建议待确认。' },
  { no: '08', name: '主要分工', instructions: '按部门或角色展示负责的功能点、职责说明、人员配置；与07章一致。无依据的人员数量用待确认。' },
  { no: '09', name: '试验资源方案', instructions: '列出试验设备工装、用途、使用说明与推荐状态。状态仅正常、校准中、维修中、不可用、待确认；无真实状态时给建议并标注待确认。' },
  { no: '10', name: '试验流程设计', instructions: '描述已确认功能点的执行顺序、前后置依赖和流转条件；合格后转下一步，异常时中止并保留现场。' },
  { no: '11', name: '试验指标要求及试验方法', instructions: '根据试验依据为本批功能点补充指标、试验方法和判定依据。不得推测缺失的数值限值。' },
]

/** 需要模型生成的章节编号（封面与 05 章由程序渲染，不由模型写）。 */
export const GENERATED_NOS = CHAPTERS.filter((c) => c.no !== '05').map((c) => c.no)

/** 按编号取章节定义；未知编号返回 undefined。 */
export function findChapter(no) {
  return CHAPTERS.find((c) => c.no === no)
}
