#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
压缩包解压工具 — 支持 ZIP/TAR/TAR.GZ/TGZ

用法:
  python extract_archive.py <压缩包路径> <目标目录> [--password <密码>]

输出 (JSON to stdout):
  { "success": true, "files": ["a.txt", "sub/b.txt"], "total_size": 12345 }
  { "success": false, "needPassword": true, "error": "..." }
  { "success": false, "error": "...", "errorDetail": "...", "errorCode": "..." }

错误码: WRONG_PASSWORD / NEED_PASSWORD / INVALID_ARCHIVE / UNKNOWN_FORMAT / EXTRACTION_ERROR
"""

import json
import os
import sys
import zipfile
import tarfile
import traceback

# ═══════════════════════════════════════════════════════
#  工具函数
# ═══════════════════════════════════════════════════════

def detect_archive_type(path):
    """检测压缩包类型"""
    lower = path.lower()
    if lower.endswith('.zip'):
        return 'zip'
    if lower.endswith('.tar.gz') or lower.endswith('.tgz'):
        return 'targz'
    if lower.endswith('.tar'):
        return 'tar'
    if lower.endswith('.gz') and not lower.endswith('.tar.gz'):
        return 'gz'
    return None


def safe_extract_path(base_dir, member_path):
    """防止路径穿越攻击"""
    abs_base = os.path.abspath(base_dir)
    abs_target = os.path.abspath(os.path.join(base_dir, member_path))
    if not abs_target.startswith(abs_base + os.sep) and abs_target != abs_base:
        raise ValueError(f"路径穿越攻击已阻止: {member_path}")
    return abs_target


def output_json(data):
    """输出 JSON 到 stdout"""
    # 只输出 JSON，不要有任何其他 stdout 输出
    sys.stdout.write(json.dumps(data, ensure_ascii=False))
    sys.stdout.flush()


def output_error(error, detail="", error_code="EXTRACTION_ERROR"):
    """输出错误 JSON"""
    output_json({
        "success": False,
        "error": error,
        "errorDetail": detail,
        "errorCode": error_code,
    })


# ═══════════════════════════════════════════════════════
#  解压函数
# ═══════════════════════════════════════════════════════

def extract_zip(archive_path, dest_dir, password=None):
    """解压 ZIP 文件"""
    try:
        with zipfile.ZipFile(archive_path, 'r') as zf:
            # 检查是否需要密码
            for info in zf.infolist():
                if info.flag_bits & 0x1:  # 加密标志
                    if password:
                        zf.setpassword(password.encode('utf-8'))
                        # 测试密码是否正确
                        try:
                            zf.read(info.filename)
                        except (RuntimeError, zipfile.BadZipFile):
                            output_error(
                                "密码错误",
                                f"文件 {info.filename} 解压密码错误",
                                "WRONG_PASSWORD"
                            )
                            return False
                    else:
                        output_error(
                            "压缩包需要密码",
                            f"文件 {info.filename} 已加密",
                            "NEED_PASSWORD"
                        )
                        return False
                    break  # 只检查第一个加密文件

            extracted = []
            total_size = 0
            for info in zf.infolist():
                # 跳过目录
                if info.filename.endswith('/'):
                    continue
                # 安全路径
                target = safe_extract_path(dest_dir, info.filename)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                # 解压
                try:
                    content = zf.read(info.filename)
                    with open(target, 'wb') as f:
                        f.write(content)
                    extracted.append(info.filename)
                    total_size += info.file_size
                except Exception as e:
                    # 单个文件失败不中断整体流程
                    continue

            output_json({
                "success": True,
                "files": extracted,
                "total_size": total_size,
            })
            return True

    except zipfile.BadZipFile as e:
        output_error("无效的 ZIP 文件", str(e), "INVALID_ARCHIVE")
        return False


def extract_tar(archive_path, dest_dir):
    """解压 TAR 文件（含 TAR.GZ / TGZ）"""
    try:
        mode = 'r'
        if archive_path.lower().endswith('.tar.gz') or archive_path.lower().endswith('.tgz'):
            mode = 'r:gz'

        with tarfile.open(archive_path, mode) as tf:
            extracted = []
            total_size = 0

            for member in tf.getmembers():
                # 跳过目录
                if member.isdir():
                    continue
                # 安全路径
                target = safe_extract_path(dest_dir, member.name)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                # 解压
                try:
                    tf.extract(member, dest_dir)
                    extracted.append(member.name)
                    if member.size is not None:
                        total_size += member.size
                except Exception as e:
                    continue

            output_json({
                "success": True,
                "files": extracted,
                "total_size": total_size,
            })
            return True

    except (tarfile.TarError, EOFError) as e:
        output_error("无效的 TAR 文件", str(e), "INVALID_ARCHIVE")
        return False


# ═══════════════════════════════════════════════════════
#  主入口
# ═══════════════════════════════════════════════════════

def main():
    if len(sys.argv) < 3:
        output_error("参数不足", "用法: extract_archive.py <压缩包路径> <目标目录> [--password <密码>]", "EXTRACTION_ERROR")
        sys.exit(1)

    archive_path = sys.argv[1]
    dest_dir = sys.argv[2]

    # 解析可选密码
    password = None
    if '--password' in sys.argv:
        idx = sys.argv.index('--password')
        if idx + 1 < len(sys.argv):
            password = sys.argv[idx + 1]

    # 检查文件存在
    if not os.path.isfile(archive_path):
        output_error("压缩包文件不存在", f"路径: {archive_path}", "INVALID_ARCHIVE")
        sys.exit(1)

    # 创建目标目录
    try:
        os.makedirs(dest_dir, exist_ok=True)
    except Exception as e:
        output_error("无法创建目标目录", str(e), "EXTRACTION_ERROR")
        sys.exit(1)

    # 检测类型
    archive_type = detect_archive_type(archive_path)
    if not archive_type:
        output_error(
            "不支持的压缩格式",
            f"支持的格式: .zip, .tar, .tar.gz, .tgz。当前文件: {archive_path}",
            "UNKNOWN_FORMAT"
        )
        sys.exit(1)

    # 执行解压
    try:
        if archive_type == 'zip':
            success = extract_zip(archive_path, dest_dir, password)
        elif archive_type in ('tar', 'targz'):
            success = extract_tar(archive_path, dest_dir)
        else:
            output_error("不支持的压缩格式", f"类型: {archive_type}", "UNKNOWN_FORMAT")
            sys.exit(1)

        sys.exit(0 if success else 1)

    except Exception as e:
        output_error("解压过程异常", traceback.format_exc(), "EXTRACTION_ERROR")
        sys.exit(1)


if __name__ == '__main__':
    main()
