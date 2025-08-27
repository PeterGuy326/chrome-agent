#!/bin/bash

# Chrome Agent + Open WebUI 启动脚本

set -e

echo "🚀 启动 Chrome Agent + Open WebUI 集成系统"
echo "======================================"

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "❌ Docker 未安装，请先安装 Docker"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose 未安装，请先安装 Docker Compose"
    exit 1
fi

# 检查端口是否被占用
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo "⚠️  端口 $port 已被占用"
        return 1
    fi
    return 0
}

echo "🔍 检查端口可用性..."

# 检查Chrome Agent是否已运行
if curl -s http://localhost:3000/ >/dev/null 2>&1; then
    echo "✅ Chrome Agent 已在运行 (http://localhost:3000)"
    CHROME_AGENT_RUNNING=true
else
    if ! check_port 3000; then
        echo "请停止占用端口 3000 的进程后重试"
        exit 1
    fi
    CHROME_AGENT_RUNNING=false
fi

if ! check_port 8080; then
    echo "请停止占用端口 8080 的进程后重试"
    exit 1
fi

# 创建必要的目录
echo "📁 创建数据目录..."
mkdir -p data logs screenshots exports

# 启动服务
echo "🐳 启动 Docker 服务..."
if [ "$CHROME_AGENT_RUNNING" = true ]; then
    echo "ℹ️  Chrome Agent 已运行，仅启动 Open WebUI"
    docker-compose up -d open-webui
else
    docker-compose up -d
fi

# 等待服务启动
echo "⏳ 等待服务启动..."
sleep 10

# 检查服务状态
echo "🔍 检查服务状态..."
if curl -s http://localhost:3000/ >/dev/null 2>&1; then
    echo "✅ Chrome Agent 服务已启动 (http://localhost:3000)"
else
    echo "❌ Chrome Agent 服务启动失败"
    if [ "$CHROME_AGENT_RUNNING" = false ]; then
        docker-compose logs chrome-agent
    fi
    exit 1
fi

if curl -f http://localhost:8080 >/dev/null 2>&1; then
    echo "✅ Open WebUI 服务已启动 (http://localhost:8080)"
else
    echo "❌ Open WebUI 服务启动失败"
    docker-compose logs open-webui
    exit 1
fi

echo ""
echo "🎉 系统启动完成！"
echo "======================================"
echo "📊 Chrome Agent API: http://localhost:3000"
echo "📊 API 文档: http://localhost:3000/docs"
echo "🌐 Open WebUI: http://localhost:8080"
echo ""
echo "💡 使用提示："
echo "   - 在 Open WebUI 中直接输入浏览器任务，如：'打开 https://example.com 并提取标题'"
echo "   - Pipeline 会自动检测并处理浏览器相关任务"
echo "   - 查看日志：docker-compose logs -f"
echo "   - 停止服务：docker-compose down"
echo ""