/**
 * Chrome Agent API服务器示例
 * 演示如何启动和使用API服务器
 */

const { createApiServer } = require('../dist/api');

async function apiServerExample() {
  console.log('🌐 Chrome Agent API服务器示例');
  
  try {
    // 1. 创建API服务器
    const server = createApiServer({
      port: 3000,
      host: 'localhost'
    });
    
    // 2. 启动服务器
    console.log('🚀 启动API服务器...');
    await server.start();
    
    console.log('✅ API服务器已启动');
    console.log('📍 服务地址: http://localhost:3000');
    console.log('📖 API文档: http://localhost:3000/docs');
    console.log('💊 健康检查: http://localhost:3000/health');
    
    // 3. 示例API调用
    console.log('\n📡 API使用示例:');
    console.log('\n1. 获取模型列表:');
    console.log('   curl http://localhost:3000/api/v1/models');
    
    console.log('\n2. 聊天接口:');
    console.log('   curl -X POST http://localhost:3000/api/v1/chat/completions \\');
    console.log('     -H "Content-Type: application/json" \\');
    console.log('     -d \'{');
    console.log('       "model": "chrome-agent",');
    console.log('       "messages": [');
    console.log('         {"role": "user", "content": "打开百度并搜索Chrome Agent"}');
    console.log('       ]');
    console.log('     }\'');
    
    // 4. 优雅关闭
    process.on('SIGINT', async () => {
      console.log('\n🛑 正在关闭服务器...');
      await server.stop();
      console.log('✅ 服务器已关闭');
      process.exit(0);
    });
    
    console.log('\n按 Ctrl+C 停止服务器');
    
  } catch (error) {
    console.error('❌ 服务器启动失败:', error.message);
  }
}

// 运行示例
if (require.main === module) {
  apiServerExample();
}

module.exports = { apiServerExample };