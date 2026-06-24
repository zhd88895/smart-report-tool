/**
 * 独立验证脚本：上传文件名中文编码修复 & 安全校验
 *
 * 覆盖场景：
 * 1. 正常中文文件名直接通过 validateFileName。
 * 2. 模拟 latin1 乱码文件名经 decodeOriginalName（等价逻辑）解码后通过校验。
 * 3. 危险文件名被拒绝：路径遍历、Windows 设备名、非法字符、隐藏文件、超长文件名。
 * 4. 正常英文文件名通过校验。
 */

import { validateFileName } from './src/middleware/security';

// 复现 upload.ts 中的 decodeOriginalName 逻辑
function decodeOriginalName(originalName: string): string {
  if (validateFileName(originalName)) {
    return originalName;
  }

  try {
    const decoded = Buffer.from(originalName, 'latin1').toString('utf8');
    if (validateFileName(decoded)) {
      return decoded;
    }
  } catch {
    // ignore
  }

  return originalName;
}

interface TestCase {
  input: string;
  expectedValid: boolean;
  description: string;
  expectDecoded?: string; // 期望解码后的文件名
}

// 构造真实的 latin1 乱码：把 UTF-8 字节流按 latin1 解码成字符串
const utf8BytesOfChinese = Buffer.from('PC模板.docx', 'utf8');
const latin1Mojibake = utf8BytesOfChinese.toString('latin1');

const cases: TestCase[] = [
  {
    input: 'PC模板.docx',
    expectedValid: true,
    description: '正常中文文件名直接校验',
  },
  {
    input: latin1Mojibake,
    expectedValid: true,
    expectDecoded: 'PC模板.docx',
    description: '模拟 latin1 乱码经 decodeOriginalName 解码后校验',
  },
  {
    input: '../etc/passwd',
    expectedValid: false,
    description: 'Unix 路径遍历',
  },
  {
    input: '..\\Windows\\System32',
    expectedValid: false,
    description: 'Windows 路径遍历',
  },
  {
    input: '/etc/hosts',
    expectedValid: false,
    description: '绝对路径',
  },
  {
    input: 'con.txt',
    expectedValid: false,
    description: 'Windows 保留设备名 con',
  },
  {
    input: 'PRN',
    expectedValid: false,
    description: 'Windows 保留设备名 PRN',
  },
  {
    input: 'NUL',
    expectedValid: false,
    description: 'Windows 保留设备名 NUL',
  },
  {
    input: 'aux',
    expectedValid: false,
    description: 'Windows 保留设备名 aux',
  },
  {
    input: '<script>.docx',
    expectedValid: false,
    description: '非法字符 < >',
  },
  {
    input: '.hidden',
    expectedValid: false,
    description: '以 . 开头的隐藏文件',
  },
  {
    input: 'a'.repeat(256) + '.docx',
    expectedValid: false,
    description: '长度 256 字符的文件名',
  },
  {
    input: 'report_v1.0.docx',
    expectedValid: true,
    description: '正常英文文件名',
  },
];

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

for (const testCase of cases) {
  const decoded = decodeOriginalName(testCase.input);
  const isValid = validateFileName(decoded);
  const passed = isValid === testCase.expectedValid;

  if (testCase.expectDecoded && decoded !== testCase.expectDecoded) {
    failures.push(
      `[DECODE_MISMATCH] ${testCase.description}\n` +
        `  input:    ${JSON.stringify(testCase.input)}\n` +
        `  expected: ${JSON.stringify(testCase.expectDecoded)}\n` +
        `  actual:   ${JSON.stringify(decoded)}`
    );
    failCount++;
    continue;
  }

  if (passed) {
    passCount++;
    console.log(`[PASS] ${testCase.description}`);
  } else {
    failCount++;
    failures.push(
      `[FAIL] ${testCase.description}\n` +
        `  input:    ${JSON.stringify(testCase.input)}\n` +
        `  decoded:  ${JSON.stringify(decoded)}\n` +
        `  expected: ${testCase.expectedValid ? 'valid' : 'invalid'}\n` +
        `  actual:   ${isValid ? 'valid' : 'invalid'}`
    );
    console.log(`[FAIL] ${testCase.description}`);
  }
}

console.log('\n--- Summary ---');
console.log(`Total: ${cases.length} | Pass: ${passCount} | Fail: ${failCount}`);

if (failures.length > 0) {
  console.log('\n--- Failures ---');
  for (const failure of failures) {
    console.log(failure);
  }
  process.exit(1);
} else {
  console.log('All checks passed.');
  process.exit(0);
}
