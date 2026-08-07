# -*- coding: utf-8 -*-
"""生成 v0.5.0 系统架构图 docs/architecture.png（深蓝商务风，与产品 UI 一致）"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(sys.executable).parent.parent.parent))
from daimon_runtime import setup_plot

setup_plot()

import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

# 配色（与前端深蓝主题一致）
C_PRIMARY = "#1e4a7a"      # 深蓝主色
C_PRIMARY_BG = "#eaf1f8"    # 主色浅底
C_SIDEBAR = "#1c3350"       # 侧边栏深蓝
C_ACCENT = "#2e6db4"        # 亮蓝
C_GRAY = "#5b6b7d"          # 中性灰
C_GRAY_BG = "#f2f5f8"       # 浅灰底
C_BORDER = "#c9d6e3"        # 边框灰蓝
C_AMBER = "#b45309"         # 支持包强调色
C_AMBER_BG = "#fdf3e3"
C_GREEN = "#2e7d4f"
C_GREEN_BG = "#e9f5ee"
C_WHITE = "#ffffff"

FIG_W, FIG_H = 12.4, 8.6
fig, ax = plt.subplots(figsize=(FIG_W, FIG_H), dpi=160)
ax.set_xlim(0, 100)
ax.set_ylim(0, 100)
ax.axis("off")
fig.patch.set_facecolor(C_WHITE)


def box(x, y, w, h, fc, ec, lw=1.2, r=1.2):
    b = FancyBboxPatch((x, y), w, h, boxstyle=f"round,pad=0,rounding_size={r}",
                       facecolor=fc, edgecolor=ec, linewidth=lw, zorder=2)
    ax.add_patch(b)


def text(x, y, s, size=10, color="#222", weight="normal", ha="center", va="center", zorder=3):
    ax.text(x, y, s, fontsize=size, color=color, fontweight=weight, ha=ha, va=va, zorder=zorder)


def arrow(x1, y1, x2, y2, color=C_GRAY, lw=1.6, style="<|-|>", label=None, label_off=(0, 1.6), ls="-"):
    a = FancyArrowPatch((x1, y1), (x2, y2), arrowstyle=style, mutation_scale=14,
                        color=color, linewidth=lw, linestyle=ls, zorder=1,
                        shrinkA=2, shrinkB=2)
    ax.add_patch(a)
    if label:
        ax.text((x1 + x2) / 2 + label_off[0], (y1 + y2) / 2 + label_off[1], label,
                fontsize=8.5, color=C_GRAY, ha="center", va="center", zorder=4,
                bbox=dict(boxstyle="round,pad=0.25", facecolor=C_WHITE, edgecolor="none"))


# ── 标题 ──
text(50, 96.5, "智能报告生成工具 · 系统架构", size=17, weight="bold", color=C_SIDEBAR)
text(50, 92.8, "v0.5.0 ｜ AI 驱动的巡检日志分析与报告生成平台（本地部署）", size=10.5, color=C_GRAY)

# ── 第 1 层：展现层 ──
box(6, 76, 88, 12, C_SIDEBAR, C_SIDEBAR)
text(50, 85.2, "展 现 层", size=10, color="#9db8d2", weight="bold")
text(50, 80.5, "浏览器  ·  React SPA（TypeScript + Tailwind + shadcn/ui）— localhost:5173",
     size=11.5, color=C_WHITE, weight="bold")

# ── 第 2 层：应用层（后端 Express）──
box(6, 36, 70, 34, C_PRIMARY_BG, C_PRIMARY, lw=1.6)
text(41, 67, "应 用 层  ·  Express 后端服务（localhost:3001）", size=11, color=C_PRIMARY, weight="bold")

# 5 个功能子模块（2 行）
mods_row1 = [
    ("认证与安全", "JWT 会话 · 滑动过期\n权限隔离 · 速率限制"),
    ("AI 服务层", "多厂商适配 · 用户级\n配置隔离 · SSE 流式"),
    ("AI Agent 工具", "读写/分析脚本\n自动执行 · 联网检索"),
]
mods_row2 = [
    ("报告引擎", "脚本执行(Python/BAT\n/PS1/SH) · 模板套用"),
    ("文件服务", "SHA-256 秒传去重\n保留天数自动清理"),
    ("知识库", "分类管理 · 分析时\n关联参考"),
]
mw, mh, gap = 20.5, 10.5, 2.2
x0 = 9.5
for i, (t, d) in enumerate(mods_row1):
    x = x0 + i * (mw + gap)
    box(x, 53.5, mw, mh, C_WHITE, C_ACCENT)
    text(x + mw / 2, 60.6, t, size=10, weight="bold", color=C_PRIMARY)
    text(x + mw / 2, 56.6, d, size=8, color=C_GRAY)
for i, (t, d) in enumerate(mods_row2):
    x = x0 + i * (mw + gap)
    box(x, 39.5, mw, mh, C_WHITE, C_ACCENT)
    text(x + mw / 2, 46.6, t, size=10, weight="bold", color=C_PRIMARY)
    text(x + mw / 2, 42.6, d, size=8, color=C_GRAY)

# ── 右侧：外部 AI 厂商 ──
box(80, 42, 14, 22, C_AMBER_BG, C_AMBER, lw=1.6)
text(87, 60.8, "AI 厂商", size=11, weight="bold", color=C_AMBER)
text(87, 57.6, "（外部服务）", size=8.5, color=C_GRAY)
text(87, 51, "小米 MiMo\nOpenAI\nOpenAI 兼容厂商\n（可扩展）", size=9, color="#7a5a2e")

# ── 第 3 层：数据层 ──
box(6, 14, 70, 16, C_GRAY_BG, C_GRAY, lw=1.4)
text(41, 26.8, "数 据 层（项目内 smart-report-server/data/）", size=10.5, color=C_SIDEBAR, weight="bold")
data_items = [
    ("SQLite 数据库", "用户/配置/报告元数据\n用量统计/去重索引"),
    ("文件存储", "脚本/模板/上传文件\n知识库/生成报告"),
    ("去重存储", "uploads/dedup/\n哈希单副本"),
]
dw = 20.5
for i, (t, d) in enumerate(data_items):
    x = x0 + i * (dw + gap)
    box(x, 15.5, dw, 8.5, C_WHITE, C_BORDER)
    text(x + dw / 2, 21.2, t, size=9.5, weight="bold", color=C_SIDEBAR)
    text(x + dw / 2, 17.8, d, size=7.5, color=C_GRAY)

# ── 右侧：内嵌执行环境 ──
box(80, 14, 14, 22, C_GREEN_BG, C_GREEN, lw=1.4)
text(87, 32.8, "执行环境", size=10.5, weight="bold", color=C_GREEN)
text(87, 26, "内嵌 Python\nvirtualenv 隔离\n多版本管理\nchild_process", size=8.5, color="#3a6b4e")

# ── 连线 ──
arrow(50, 76, 50, 70.5, label="REST API / SSE 流式", label_off=(10.5, 0.6))
arrow(76, 53, 80, 53, color=C_AMBER, label="HTTPS 流式调用", label_off=(-1.5, -3))
arrow(50, 36, 50, 30.5, label="读写", label_off=(5, 0.5))
arrow(82, 36.5, 74, 39.5, color=C_GREEN, style="-|>", label=None)

# 图例
text(87, 8.5, "本地部署 · 数据不出内网\nAI 调用经用户自有 Key 直连厂商", size=8.5, color=C_GRAY)

out = Path("docs/architecture.png")
fig.savefig(out, bbox_inches="tight", facecolor=C_WHITE)
print(f"saved: {out} ({out.stat().st_size} bytes)")
