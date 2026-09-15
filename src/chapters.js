/**
 * 试验方案章节目录：编号与名称，只用于公文顺序。
 *
 * 各章写什么以 templates/dynamic-v1 当前文件为准，目录不规定章节内容。
 */

/** 全部章节，按公文顺序（封面 → 01…11）。 */
export const CHAPTERS = [
  { no: 'cover', name: '封面' },
  { no: '01', name: '范围' },
  { no: '02', name: '规范性引用文件' },
  { no: '03', name: '术语定义' },
  { no: '04', name: '系统简介' },
  { no: '05', name: '试验项目' },
  { no: '06', name: '试验注意事项' },
  { no: '07', name: '分离面设计原则' },
  { no: '08', name: '主要分工' },
  { no: '09', name: '试验资源方案' },
  { no: '10', name: '试验流程设计' },
  { no: '11', name: '试验指标要求及试验方法' },
]

/** 公文顺序下的章节编号，写章与落盘都按此顺序，不得乱序。 */
export const DOCUMENT_ORDER = CHAPTERS.map((c) => c.no)

/** 按编号取章节定义；未知编号返回 undefined。 */
export function findChapter(no) {
  return CHAPTERS.find((c) => c.no === no)
}

/**
 * 下一章应写的编号：公文顺序里第一个尚未写入的章。
 * @param written - 已写章节表（key 为章节编号）。
 * @returns 下一章编号；全部写完时返回 undefined。
 */
export function nextChapter(written) {
  return DOCUMENT_ORDER.find((no) => !written[no])
}
