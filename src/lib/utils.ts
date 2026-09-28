import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 企业名归一化：去括号备注、去空白、转小写 —— 用于同名匹配（备份导入/去重） */
export function normalizeName(n: string): string {
  return n
    .replace(/（.*?）/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\s/g, "")
    .toLowerCase()
}
