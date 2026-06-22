// src/utils/localeUtils.ts

/**
 * 将自定义文本字符串解析为对象。
 * 值应该是经过 URL 编码的。
 * @param customTexts 要解析的字符串 (例如, "key1:value%201,key2:value%2C2")。
 * @returns 自定义文本的记录。
 */
export const parseCustomTexts = (
  customTexts: string
): Record<string, string> => {
  if (!customTexts) {
    return {};
  }

  const result: Record<string, string> = {};
  const pairs = customTexts.split(",");

  for (const pair of pairs) {
    const separatorIndex = pair.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = pair.substring(0, separatorIndex).trim();
    const value = pair.substring(separatorIndex + 1).trim();

    if (key) {
      try {
        result[key] = decodeURIComponent(value);
      } catch (e) {
        console.error(`无法解码自定义文本值: ${value}`, e);
        result[key] = value; // 回退到原始值
      }
    }
  }

  return result;
};

/**
 * 将自定义文本记录序列化为 URL 编码的字符串。
 * @param customTextsRecord 自定义文本的记录。
 * @returns 一个 URL 编码的字符串 (例如, "key1:value%201,key2:value%2C2")。
 */
export const serializeCustomTexts = (
  customTextsRecord: Record<string, string>
): string => {
  return Object.entries(customTextsRecord)
    .map(([key, value]) => `${key.trim()}:${encodeURIComponent(value.trim())}`)
    .join(",");
};

/**
 * 将嵌套对象扁平化为单层对象。
 * @param obj 要扁平化的对象。
 * @param parentKey 当前递归级别的父键。
 * @param separator 用于在键之间分隔的分隔符。
 * @returns 一个扁平化的对象。
 */
export const flattenObject = (
  obj: any,
  parentKey = "",
  separator = "."
): Record<string, string> => {
  const result: Record<string, string> = {};

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const newKey = parentKey ? `${parentKey}${separator}${key}` : key;
      if (
        typeof obj[key] === "object" &&
        obj[key] !== null &&
        !Array.isArray(obj[key])
      ) {
        Object.assign(result, flattenObject(obj[key], newKey, separator));
      } else {
        result[newKey] = obj[key];
      }
    }
  }

  return result;
};

/**
 * 将自定义文本合并到默认文本中。
 * @param defaultTexts 默认文本对象。
 * @param customTexts 自定义文本字符串 (例如, "key1:value%201,key2:value%2C2")。
 * @returns 包含合并后文本的新对象。
 */
export const mergeTexts = (defaultTexts: any, customTexts: string): any => {
  const parsedCustomTexts = parseCustomTexts(customTexts);
  const merged = JSON.parse(JSON.stringify(defaultTexts));
  const flatDefault = flattenObject(defaultTexts);

  for (const key in parsedCustomTexts) {
    if (
      Object.prototype.hasOwnProperty.call(parsedCustomTexts, key) &&
      flatDefault[key] !== parsedCustomTexts[key]
    ) {
      const keys = key.split(".");
      let current = merged;
      for (let i = 0; i < keys.length - 1; i++) {
        current = current[keys[i]] = current[keys[i]] || {};
      }
      current[keys[keys.length - 1]] = parsedCustomTexts[key];
    }
  }

  return merged;
};

/**
 * 获取在自定义文本中被修改的键。
 * @param defaultTexts 默认文本对象。
 * @param customTexts 自定义文本字符串 (例如, "key1:value%201,key2:value%2C2")。
 * @returns 一个包含被修改键的数组。
 */
export const getModifiedKeys = (
  defaultTexts: any,
  customTexts: string
): string[] => {
  const parsedCustomTexts = parseCustomTexts(customTexts);
  const flatDefault = flattenObject(defaultTexts);
  const modifiedKeys: string[] = [];

  for (const key in parsedCustomTexts) {
    if (Object.prototype.hasOwnProperty.call(parsedCustomTexts, key)) {
      if (flatDefault[key] !== parsedCustomTexts[key]) {
        modifiedKeys.push(key);
      }
    }
  }

  return modifiedKeys;
};

/**
 * 检查一个值是否为对象。
 * @param item 要检查的值。
 * @returns 如果值是对象则返回 true，否则返回 false。
 */
const isObject = (item: any): item is Record<string, any> => {
  return item && typeof item === "object" && !Array.isArray(item);
};

/**
 * 深度合并两个对象。
 * @param target 要合并到的目标对象。
 * @param source 要从中合并的源对象。
 * @returns 合并后的对象。
 */
export const deepMerge = <T extends object, S extends object>(
  target: T,
  source: S
): T & S => {
  const output = { ...target } as T & S;

  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      const sourceKey = key as keyof S;
      if (isObject(source[sourceKey])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[sourceKey] });
        } else {
          (output as any)[key] = deepMerge(
            (target as any)[key],
            source[sourceKey]
          );
        }
      } else {
        Object.assign(output, { [key]: source[sourceKey] });
      }
    });
  }

  return output;
};
