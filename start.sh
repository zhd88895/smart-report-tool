#!/bin/bash
echo "========================================"
echo "智能报告生成工具 - 启动脚本"
echo "========================================"
echo ""

# Get script directory
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Start backend
echo "正在启动后端服务 (localhost:3001)..."
cd "$DIR/smart-report-server" && npx tsx watch src/index.ts &
BACKEND_PID=$!

sleep 3

# Start frontend
echo "正在启动前端服务 (localhost:5173)..."
cd "$DIR/smart-report-tool" && npx vite --port 5173 &
FRONTEND_PID=$!

echo ""
echo "========================================"
echo "系统已启动！"
echo "前端: http://localhost:5173"
echo "后端: http://localhost:3001"
echo "========================================"
echo ""
echo "按 Ctrl+C 停止所有服务"

wait $BACKEND_PID $FRONTEND_PID
