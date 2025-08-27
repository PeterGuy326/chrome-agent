FROM node:18-alpine

# 安装Chrome依赖
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    curl

# 设置Chrome路径
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# 创建应用目录
WORKDIR /app

# 复制package文件
COPY package*.json ./

# 安装依赖
RUN npm ci --only=production

# 复制源代码
COPY . .

# 构建应用
RUN npm run build

# 创建数据目录
RUN mkdir -p /app/data /app/logs /app/screenshots /app/exports

# 设置权限
RUN addgroup -g 1001 -S nodejs && \
    adduser -S chrome -u 1001 -G nodejs && \
    chown -R chrome:nodejs /app

# 切换到非root用户
USER chrome

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# 启动命令
CMD ["node", "dist/cli/index.js", "serve", "--port", "3000", "--host", "0.0.0.0"]