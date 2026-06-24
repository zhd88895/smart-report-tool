#!/bin/bash
# ============================================================
#  Smart Report Tool - One-Click Start Script (Linux/Mac)
#  Version: v0.4.0
# ============================================================

set -e

VERSION="0.4.0"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Color definitions
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

echo ""
echo -e "${CYAN}====================================================${NC}"
echo -e "${WHITE}        Smart Report Tool v${VERSION}${NC}"
echo -e "${CYAN}====================================================${NC}"
echo -e "${GREEN}  Backend:   http://localhost:3001${NC}"
echo -e "${GREEN}  Frontend:  http://localhost:5173${NC}"
echo -e "${CYAN}====================================================${NC}"
echo -e "${YELLOW}  Press Ctrl+C to stop all services${NC}"
echo -e "${CYAN}====================================================${NC}"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}[ERROR] Node.js is not installed. Please install Node.js 18+${NC}"
    exit 1
fi

NODE_VERSION=$(node --version)
echo -e "${GREEN}OK Node.js: ${NODE_VERSION}${NC}"

# Install backend dependencies
if [ ! -d "$ROOT_DIR/smart-report-server/node_modules" ]; then
    echo -e "${YELLOW}[INSTALL] Installing backend dependencies...${NC}"
    cd "$ROOT_DIR/smart-report-server"
    npm install
    cd "$ROOT_DIR"
else
    echo -e "${GREEN}OK Backend dependencies installed${NC}"
fi

# Install frontend dependencies
if [ ! -d "$ROOT_DIR/smart-report-tool/node_modules" ]; then
    echo -e "${YELLOW}[INSTALL] Installing frontend dependencies...${NC}"
    cd "$ROOT_DIR/smart-report-tool"
    npm install
    cd "$ROOT_DIR"
else
    echo -e "${GREEN}OK Frontend dependencies installed${NC}"
fi

# Create .env file if not exists
if [ ! -f "$ROOT_DIR/smart-report-server/.env" ]; then
    if [ -f "$ROOT_DIR/smart-report-server/.env.example" ]; then
        echo -e "${YELLOW}[CONFIG] Creating environment config...${NC}"
        cp "$ROOT_DIR/smart-report-server/.env.example" "$ROOT_DIR/smart-report-server/.env"
        echo -e "${YELLOW}WARN Please edit smart-report-server/.env and set JWT_SECRET${NC}"
    fi
fi

# Cleanup function
cleanup() {
    echo ""
    echo -e "${YELLOW}[STOP] Stopping all services...${NC}"
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    wait $BACKEND_PID 2>/dev/null || true
    wait $FRONTEND_PID 2>/dev/null || true
    echo -e "${GREEN}[DONE] All services stopped${NC}"
    echo ""
}

# Register cleanup function
trap cleanup EXIT INT TERM

# Start backend
echo -e "${CYAN}[START] Starting backend service...${NC}"
cd "$ROOT_DIR/smart-report-server"
npx tsx src/index.ts &
BACKEND_PID=$!
cd "$ROOT_DIR"

# Wait for backend to start
sleep 2

# Start frontend
echo -e "${CYAN}[START] Starting frontend service...${NC}"
cd "$ROOT_DIR/smart-report-tool"
npx vite --port 5173 &
FRONTEND_PID=$!
cd "$ROOT_DIR"

echo ""
echo -e "${GREEN}[DONE] Services are starting, please wait...${NC}"
echo ""

# Wait for any process to exit
wait -n

# If any process exits, stop the other
kill $BACKEND_PID 2>/dev/null || true
kill $FRONTEND_PID 2>/dev/null || true
