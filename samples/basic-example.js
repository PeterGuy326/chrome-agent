/**
 * Chrome Agent 基础示例
 * 演示如何使用Chrome Agent进行简单的网页自动化
 */

const { Executor } = require('../dist/executor');
const { IntentParser } = require('../dist/intent');
const { Planner } = require('../dist/planner');

async function basicExample() {
  console.log('🚀 Chrome Agent 基础示例');
  
  try {
    // 1. 创建执行器
    const executor = new Executor({
      headless: false,
      timeout: 30000
    });
    
    // 2. 创建意图解析器和计划器
    const parser = new IntentParser();
    const planner = new Planner();
    
    // 3. 解析用户意图
    const intent = await parser.parseIntent('打开百度首页并搜索Chrome Agent');
    console.log('📝 解析的意图:', intent);
    
    // 4. 生成执行计划
    const plan = await planner.generatePlan('demo-task', [intent], {
      currentUrl: 'https://www.baidu.com'
    });
    console.log('📋 生成的计划:', plan);
    
    // 5. 执行计划
    console.log('⚡ 开始执行...');
    const result = await executor.executePlan(plan);
    console.log('✅ 执行完成:', result);
    
  } catch (error) {
    console.error('❌ 执行失败:', error.message);
  }
}

// 运行示例
if (require.main === module) {
  basicExample();
}

module.exports = { basicExample };