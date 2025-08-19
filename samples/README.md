# Chrome Agent 示例

这个目录包含了Chrome Agent的使用示例，帮助您快速上手。

## 安装依赖

```bash
npm install
```

## 示例列表

### 1. 基础示例 (basic-example.js)

演示Chrome Agent的基本使用流程：
- 意图解析
- 计划生成
- 任务执行

```bash
npm run basic
```

### 2. 数据抽取示例 (data-extraction-example.js)

演示如何从网页抽取结构化数据：
- 定义抽取规则
- 执行数据抽取
- 保存抽取结果

```bash
npm run extract
```

### 3. API服务器示例 (api-server-example.js)

演示如何启动和使用API服务器：
- 启动HTTP服务器
- 兼容OpenAI API格式
- RESTful接口调用

```bash
npm run server
```

## 使用说明

### 环境要求

- Node.js 16+
- Chrome/Chromium 浏览器

### 配置选项

大部分示例支持以下配置：

- `headless`: 是否无头模式运行（默认：false）
- `timeout`: 操作超时时间（默认：30秒）
- `viewport`: 浏览器视窗大小

### 输出目录

- `../exports/`: 数据抽取结果
- `../logs/`: 运行日志
- `../screenshots/`: 截图文件

## 进阶使用

### 自定义抽取规则

创建 `rules/` 目录并添加JSON格式的抽取规则：

```json
{
  "type": "list",
  "selector": ".item",
  "fields": {
    "title": {
      "type": "text",
      "selector": ".title"
    },
    "link": {
      "type": "attribute",
      "selector": "a",
      "attribute": "href"
    }
  }
}
```

### CLI工具使用

也可以直接使用CLI工具：

```bash
# 执行自动化任务
chrome-agent run "打开百度并搜索Chrome Agent" --url https://www.baidu.com

# 抽取网页数据
chrome-agent extract https://news.ycombinator.com --selector ".athing" --output data.json

# 启动API服务器
chrome-agent serve --port 3000
```

## 故障排除

### 常见问题

1. **Chrome浏览器未找到**
   - 确保已安装Chrome或Chromium
   - 设置环境变量 `CHROME_PATH`

2. **网络超时**
   - 增加timeout配置
   - 检查网络连接

3. **选择器无效**
   - 使用浏览器开发者工具验证选择器
   - 尝试更通用的选择器

### 调试模式

设置环境变量启用调试：

```bash
DEBUG=chrome-agent:* npm run basic
```

## 更多资源

- [Chrome Agent 文档](../docs/)
- [API参考](../docs/api.md)
- [配置指南](../docs/config.md)