#!/bin/bash
# ═══════════════════════════════════════════════════════
#  智能报告生成工具 API 测试脚本 (Bash)
# ═══════════════════════════════════════════════════════
#
# 使用方法：
#   1. 确保服务器已启动：npm run dev
#   2. 运行测试：bash test-api.sh
#
# 依赖：curl, jq (可选，用于美化JSON输出)
# ═══════════════════════════════════════════════════════

BASE_URL="http://localhost:3001"
TOKEN=""
PASS_COUNT=0
FAIL_COUNT=0

# 检查 jq 是否可用
if command -v jq &> /dev/null; then
  JQ="jq ."
else
  JQ="cat"
  echo "提示：安装 jq 可获得更好的 JSON 美化输出"
fi

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;37m'
NC='\033[0m' # 无颜色

# 辅助函数：测试端点
test_endpoint() {
  local name="$1"
  local method="$2"
  local path="$3"
  local body="$4"
  local expected_status="${5:-200}"
  local no_auth="$6"
  
  echo -e "\n--- $name ---"
  
  local auth_header=""
  if [ "$no_auth" != "true" ] && [ -n "$TOKEN" ]; then
    auth_header="-H \"Authorization: Bearer $TOKEN\""
  fi
  
  local curl_cmd="curl -s -w '\n%{http_code}' -X $method"
  
  if [ "$method" = "POST" ] && [ -n "$body" ]; then
    curl_cmd="$curl_cmd -H 'Content-Type: application/json' -d '$body'"
  fi
  
  if [ "$no_auth" != "true" ] && [ -n "$TOKEN" ]; then
    curl_cmd="$curl_cmd -H 'Authorization: Bearer $TOKEN'"
  fi
  
  curl_cmd="$curl_cmd '$BASE_URL$path'"
  
  local response
  response=$(eval "$curl_cmd" 2>/dev/null)
  
  # 分离响应体和状态码
  local http_code
  http_code=$(echo "$response" | tail -1)
  local response_body
  response_body=$(echo "$response" | sed '$d')
  
  if [ "$http_code" = "$expected_status" ]; then
    echo -e "  ${GREEN}[PASS]${NC} 状态码: $http_code"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo -e "  ${RED}[FAIL]${NC} 期望状态码 $expected_status，实际 $http_code"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
  
  echo -e "  ${GRAY}响应: $(echo "$response_body" | $JQ 2>/dev/null || echo "$response_body")${NC}"
  
  # 返回响应体供调用者使用
  echo "$response_body"
}

# ═══════════════════════════════════════════════════════
#  测试开始
# ═══════════════════════════════════════════════════════

echo -e "${YELLOW}═══════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}  智能报告生成工具 API 测试${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════${NC}"

# ═══════════════════════════════════════════════════════
#  1. 健康检查（不需要认证）
# ═══════════════════════════════════════════════════════

echo -e "\n${CYAN}[1/7] 健康检查${NC}"
test_endpoint "GET /api/health" "GET" "/api/health" "" 200 true > /dev/null

# ═══════════════════════════════════════════════════════
#  2. 用户注册
# ═══════════════════════════════════════════════════════

echo -e "\n${CYAN}[2/7] 用户注册${NC}"
RANDOM_NUM=$((RANDOM % 9999))
REGISTER_BODY="{\"username\":\"testuser_$RANDOM_NUM\",\"password\":\"Test1234\",\"displayName\":\"Test User\",\"region\":\"华东区\"}"
test_endpoint "POST /api/users/register" "POST" "/api/users/register" "$REGISTER_BODY" 200 true > /dev/null

# ═══════════════════════════════════════════════════════
#  3. 用户登录（获取Token）
# ═══════════════════════════════════════════════════════

echo -e "\n${CYAN}[3/7] 用户登录${NC}"
LOGIN_BODY='{"username":"ZHD","password":"Aa123456"}'
LOGIN_RESPONSE=$(test_endpoint "POST /api/users/login" "POST" "/api/users/login" "$LOGIN_BODY" 200 true)

# 从登录响应中提取Token（如果有 jq）
if command -v jq &> /dev/null; then
  TOKEN=$(echo "$LOGIN_RESPONSE" | tail -1 | jq -r '.data.token // empty' 2>/dev/null)
fi

if [ -n "$TOKEN" ]; then
  echo -e "  ${GREEN}Token获取成功${NC}"
else
  echo -e "  ${YELLOW}[WARN] 未获取到Token，后续认证测试可能失败${NC}"
fi

# ═══════════════════════════════════════════════════════
#  4. 获取脚本列表（需要认证）
# ═══════════════════════════════════════════════════════

echo -e "\n${CYAN}[4/7] 获取脚本列表${NC}"
test_endpoint "GET /api/scripts" "GET" "/api/scripts" "" 200 > /dev/null

# ═══════════════════════════════════════════════════════
#  5. 获取模板列表（需要认证）
# ═══════════════════════════════════════════════════════

echo -e "\n${CYAN}[5/7] 获取模板列表${NC}"
test_endpoint "GET /api/templates" "GET" "/api/templates" "" 200 > /dev/null

# ═══════════════════════════════════════════════════════
#  6. 获取报告列表（需要认证）
# ═══════════════════════════════════════════════════════

echo -e "\n${CYAN}[6/7] 获取报告列表${NC}"
test_endpoint "GET /api/reports" "GET" "/api/reports" "" 200 > /dev/null

# ═══════════════════════════════════════════════════════
#  7. 测试未认证访问（应返回401）
# ═══════════════════════════════════════════════════════

echo -e "\n${CYAN}[7/7] 测试未认证访问${NC}"
OLD_TOKEN="$TOKEN"
TOKEN=""
test_endpoint "GET /api/scripts (无Token)" "GET" "/api/scripts" "" 401 > /dev/null
TOKEN="$OLD_TOKEN"

# ═══════════════════════════════════════════════════════
#  404 测试
# ═══════════════════════════════════════════════════════

echo -e "\n${CYAN}[附加] 404测试${NC}"
test_endpoint "GET /api/nonexistent" "GET" "/api/nonexistent" "" 404 true > /dev/null

# ═══════════════════════════════════════════════════════
#  测试结果汇总
# ═══════════════════════════════════════════════════════

echo -e "\n${YELLOW}═══════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}  测试结果汇总${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════${NC}"
echo -e "  ${GREEN}通过: $PASS_COUNT${NC}"
echo -e "  ${RED}失败: $FAIL_COUNT${NC}"
echo -e "  ${CYAN}总计: $((PASS_COUNT + FAIL_COUNT))${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════${NC}"

if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "\n${GREEN}所有测试通过！${NC}"
  exit 0
else
  echo -e "\n${RED}有测试失败，请检查服务器日志。${NC}"
  exit 1
fi
