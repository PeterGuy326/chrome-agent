/**
 * Chrome Agent 数据抽取示例
 * 演示如何从网页抽取结构化数据
 */

const { Executor } = require('../dist/executor');
const { DataExtractor } = require('../dist/extractor');
const { ExtractionType, FieldType } = require('../dist/core/types');

async function dataExtractionExample() {
  console.log('🔍 Chrome Agent 数据抽取示例');
  
  try {
    // 1. 创建执行器和抽取器
    const executor = new Executor({
      headless: false,
      timeout: 30000
    });
    
    const extractor = new DataExtractor();
    
    // 2. 导航到目标页面
    const context = await executor.createContext();
    await context.page.goto('https://news.ycombinator.com');
    
    // 3. 定义抽取规则
    const rule = {
      type: ExtractionType.LIST,
      selector: '.athing',
      fields: {
        title: {
          type: FieldType.TEXT,
          selector: '.titleline > a'
        },
        url: {
          type: FieldType.ATTRIBUTE,
          selector: '.titleline > a',
          attribute: 'href'
        },
        score: {
          type: FieldType.TEXT,
          selector: '.score'
        }
      }
    };
    
    // 4. 执行数据抽取
    console.log('📊 开始抽取数据...');
    const data = await extractor.extract(context.page, rule);
    
    console.log(`✅ 抽取完成，共获取 ${data.length} 条数据`);
    console.log('前3条数据:', data.slice(0, 3));
    
    // 5. 保存数据
    const fs = require('fs/promises');
    await fs.writeFile(
      './exports/hacker-news-data.json', 
      JSON.stringify(data, null, 2)
    );
    console.log('💾 数据已保存到 ./exports/hacker-news-data.json');
    
  } catch (error) {
    console.error('❌ 抽取失败:', error.message);
  }
}

// 运行示例
if (require.main === module) {
  dataExtractionExample();
}

module.exports = { dataExtractionExample };